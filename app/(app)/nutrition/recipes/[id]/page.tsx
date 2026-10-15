import { redirect } from 'next/navigation'

export default function RecipeDetailRedirectPage({
  params,
}: {
  params: { id: string }
}) {
  redirect(`/recipes/${params.id}`)
}
