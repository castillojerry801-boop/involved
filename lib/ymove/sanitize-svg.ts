/**
 * Strict allowlist SVG sanitizer for YMove body-map responses.
 *
 * Defense-in-depth: two passes before any SVG reaches a renderer.
 *
 * Pass 1 — targeted pre-strip:
 *   Removes elements whose inner content must also be discarded (script,
 *   foreignObject, use, iframe, object, embed, animate*). Regex is intentionally
 *   narrow: it only targets the small set of elements that can carry executable or
 *   exfiltration payloads even after the tag itself is removed.
 *
 * Pass 2 — allowlist via sanitize-html (htmlparser2):
 *   Enforces a strict tag + attribute allowlist. Anything not explicitly permitted
 *   is stripped. This pass catches any tag or attribute not handled by Pass 1 and
 *   is maintained by the sanitize-html team rather than hand-rolled regex.
 *
 * Allowed elements: svg, g, path, circle, ellipse, rect, title, desc,
 *   defs, clippath, mask, symbol
 * Allowed attributes: geometry, presentation, accessibility, data-region
 * Forbidden unconditionally: script, foreignObject, use, iframe, object,
 *   on* event handlers, javascript:/data: URIs, xlink:href, any unlisted attr
 *
 * Returns null if the input doesn't look like valid SVG — caller falls back to
 * text-tag rendering.
 */

import sanitizeHtml from 'sanitize-html'

// ── Pass 1: pre-strip elements whose content must also be removed ─────────────

// Elements where both the tag AND inner content must go (not just the tag).
// sanitize-html's `discard` mode removes the tag but leaves inner text; for
// these elements the inner text is equally dangerous or useless.
const STRIP_WITH_CONTENT_TAGS = [
  'script', 'foreignobject', 'use', 'iframe', 'object', 'embed',
  'animate', 'set', 'animatetransform', 'animatemotion',
]

function buildStripWithContentRe(): RegExp {
  const t = STRIP_WITH_CONTENT_TAGS.join('|')
  // Matches paired <tag>…</tag> (lazy) and self-closing <tag/>
  return new RegExp(
    `<(?:${t})\\b[^>]*>(?:[\\s\\S]*?)<\\/(?:${t})>|<(?:${t})\\b[^>]*\\/?>`,
    'gi',
  )
}

const STRIP_WITH_CONTENT_RE = buildStripWithContentRe()

// Catch orphaned closing tags left by nested-element mis-matches in Pass 1
function buildOrphanCloseRe(): RegExp {
  const t = STRIP_WITH_CONTENT_TAGS.join('|')
  return new RegExp(`<\\/(?:${t})>`, 'gi')
}

const ORPHAN_CLOSE_RE = buildOrphanCloseRe()

// ── Pass 2: sanitize-html allowlist ──────────────────────────────────────────

const ALLOWED_TAGS: string[] = [
  'svg', 'g', 'path', 'circle', 'ellipse', 'rect',
  'title', 'desc', 'defs', 'clippath', 'mask', 'symbol',
]

// Presentation attributes shared by shape elements
const SHAPE_ATTRS = [
  'fill', 'fill-opacity', 'fill-rule',
  'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
  'opacity', 'transform', 'id', 'class',
]

const ALLOWED_ATTRS: sanitizeHtml.IOptions['allowedAttributes'] = {
  svg: [
    'xmlns', 'viewbox', 'width', 'height', 'preserveaspectratio',
    'role', 'aria-label', 'aria-hidden',
    'id', 'class',
  ],
  g: [...SHAPE_ATTRS, 'clip-path', 'mask', 'data-region'],
  path: ['d', ...SHAPE_ATTRS],
  circle: ['cx', 'cy', 'r', ...SHAPE_ATTRS],
  ellipse: ['cx', 'cy', 'rx', 'ry', ...SHAPE_ATTRS],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry', ...SHAPE_ATTRS],
  title:   [],
  desc:    [],
  defs:    [],
  clippath: ['id'],
  mask:     ['id'],
  symbol:   ['id', 'viewbox'],
}

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: ALLOWED_ATTRS,
  // Never allow any URL scheme — href/src are not in allowedAttributes anyway
  allowedSchemes: [],
  // Remove unknown tags; their inner text is harmless in SVG context (text nodes
  // outside <text> elements are invisible), but stripping them keeps output clean.
  disallowedTagsMode: 'discard',
}

// ── Public API ────────────────────────────────────────────────────────────────

export function sanitizeSvg(raw: string): string | null {
  if (typeof raw !== 'string') return null

  let svg = raw.trim()

  // Strip XML declaration — not needed for inline SVG
  svg = svg.replace(/^<\?xml\b[^>]*\?>\s*/i, '')

  // Must start with an SVG element
  if (!/^<svg[\s>]/i.test(svg)) return null

  // Pass 1: remove dangerous elements and their content
  svg = svg.replace(STRIP_WITH_CONTENT_RE, '')
  svg = svg.replace(STRIP_WITH_CONTENT_RE, '')   // second pass for nesting
  svg = svg.replace(ORPHAN_CLOSE_RE, '')          // clean up any residual closing tags

  // Pass 2: strict allowlist via sanitize-html
  svg = sanitizeHtml(svg, SANITIZE_OPTIONS)

  // Final structure check — must still contain an svg element
  if (!svg || !/<svg[\s>]/i.test(svg)) return null

  return svg
}
