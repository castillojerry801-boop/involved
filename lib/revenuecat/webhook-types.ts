// RevenueCat V1 webhook event type definitions.
// Source: https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields

export type RCStore =
  | 'APP_STORE'
  | 'PLAY_STORE'
  | 'STRIPE'
  | 'MAC_APP_STORE'
  | 'PROMOTIONAL'
  | 'AMAZON'
  | 'UNKNOWN_STORE'

export type RCEnvironment = 'SANDBOX' | 'PRODUCTION'

export type RCCancelReason =
  | 'UNSUBSCRIBE'
  | 'BILLING_ERROR'
  | 'DEVELOPER_INITIATED'
  | 'PRICE_INCREASE'
  | 'CUSTOMER_SUPPORT'
  | 'UNKNOWN'

export type RCPeriodType = 'NORMAL' | 'TRIAL' | 'INTRO' | 'PREPAID'

export type RCEventType =
  | 'INITIAL_PURCHASE'
  | 'RENEWAL'
  | 'PRODUCT_CHANGE'
  | 'CANCELLATION'
  | 'UNCANCELLATION'
  | 'BILLING_ISSUE'
  | 'SUBSCRIBER_ALIAS'
  | 'SUBSCRIPTION_PAUSED'
  | 'EXPIRATION'
  | 'TRANSFER'
  | 'TEST'
  | 'NON_SUBSCRIPTION_PURCHASE'
  | 'SUBSCRIPTION_EXTENDED'
  | 'REFUND_REVERSED'
  | 'INVOICE_ISSUANCE'

// Fields shared by all subscription events
interface RCEventBase {
  id: string
  type: RCEventType
  app_user_id: string
  event_timestamp_ms: number
  store: RCStore
  environment: RCEnvironment
  original_app_user_id?: string | null
  aliases?: string[]
  // Subscription-related (absent on some event types)
  original_transaction_id?: string | null
  product_id?: string | null
  purchased_at_ms?: number | null
  expiration_at_ms?: number | null
  period_type?: RCPeriodType | null
  price?: number | null
  price_in_purchased_currency?: number | null
  currency?: string | null
  is_trial_conversion?: boolean | null
}

export interface RCInitialPurchaseEvent extends RCEventBase {
  type: 'INITIAL_PURCHASE'
}

export interface RCRenewalEvent extends RCEventBase {
  type: 'RENEWAL'
}

export interface RCCancellationEvent extends RCEventBase {
  type: 'CANCELLATION'
  cancel_reason: RCCancelReason
}

export interface RCExpirationEvent extends RCEventBase {
  type: 'EXPIRATION'
  expiration_reason?: string | null
}

export interface RCBillingIssueEvent extends RCEventBase {
  type: 'BILLING_ISSUE'
  grace_period_expires_at_ms?: number | null
}

export interface RCUncancellationEvent extends RCEventBase {
  type: 'UNCANCELLATION'
}

export interface RCSubscriptionPausedEvent extends RCEventBase {
  type: 'SUBSCRIPTION_PAUSED'
  auto_resume_at_ms?: number | null
}

export interface RCSubscriptionExtendedEvent extends RCEventBase {
  type: 'SUBSCRIPTION_EXTENDED'
}

export interface RCRefundReversedEvent extends RCEventBase {
  type: 'REFUND_REVERSED'
}

export interface RCTransferEvent extends RCEventBase {
  type: 'TRANSFER'
  transferred_from: string[]
  transferred_to: string[]
}

export type RCEvent =
  | RCInitialPurchaseEvent
  | RCRenewalEvent
  | RCCancellationEvent
  | RCExpirationEvent
  | RCBillingIssueEvent
  | RCUncancellationEvent
  | RCSubscriptionPausedEvent
  | RCSubscriptionExtendedEvent
  | RCRefundReversedEvent
  | RCTransferEvent
  | (RCEventBase & {
      type: Exclude<
        RCEventType,
        | 'INITIAL_PURCHASE'
        | 'RENEWAL'
        | 'CANCELLATION'
        | 'EXPIRATION'
        | 'BILLING_ISSUE'
        | 'UNCANCELLATION'
        | 'SUBSCRIPTION_PAUSED'
        | 'SUBSCRIPTION_EXTENDED'
        | 'REFUND_REVERSED'
        | 'TRANSFER'
      >
    })

export interface RCWebhookPayload {
  event: RCEvent
  api_version: string
}
