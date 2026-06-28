// ════════════════════════════════════════════════════════════
// lib/mpesa.ts
// Safaricom Daraja API v2 — M-Pesa STK Push (Lipa na M-Pesa)
//
// Flow:
//  1. Client hits POST /api/sales/mpesa/stk-push
//  2. We request STK Push from Daraja — customer gets prompt
//  3. Customer enters PIN on their phone
//  4. Daraja calls our callback URL (POST /api/sales/mpesa/callback)
//  5. We verify, update payment status, and emit Socket event
//
// Load considerations:
//  - Access token cached in Redis (expires in 3599s — refresh 1min early)
//  - Callback handler is idempotent — safe to retry
//  - Pending STK requests stored in Redis with TTL of 5min
// ════════════════════════════════════════════════════════════

import axios   from 'axios'
import { env } from '../config/env'
import { redis }  from '../config/redis'
import { logger } from './logger'

const DARAJA_BASE = env.NODE_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke'

const SHORTCODE        = process.env.MPESA_SHORTCODE    ?? '174379'    // sandbox default
const PASSKEY          = process.env.MPESA_PASSKEY      ?? 'sandbox-passkey'
const CONSUMER_KEY     = process.env.MPESA_CONSUMER_KEY ?? ''
const CONSUMER_SECRET  = process.env.MPESA_CONSUMER_SECRET ?? ''
const CALLBACK_URL     = `${env.API_URL}/api/sales/mpesa/callback`

// ── Get / cache OAuth token ───────────────────────────────
async function getAccessToken(): Promise<string> {
  const cached = await redis.get('mpesa:token')
  if (cached) return cached

  const creds    = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64')
  const response = await axios.get(
    `${DARAJA_BASE}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${creds}` } },
  )

  const token = response.data.access_token
  const expiry = parseInt(response.data.expires_in, 10) - 60 // refresh 1min early
  await redis.setex('mpesa:token', expiry, token)

  logger.info('M-Pesa access token refreshed')
  return token
}

// ── Generate password for STK push ───────────────────────
function generatePassword(): { password: string; timestamp: string } {
  const timestamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, '')
    .slice(0, 14) // YYYYMMDDHHmmss

  const raw      = `${SHORTCODE}${PASSKEY}${timestamp}`
  const password = Buffer.from(raw).toString('base64')
  return { password, timestamp }
}

// ── Normalize Kenyan phone number ─────────────────────────
function normalizePhone(phone: string): string {
  const stripped = phone.replace(/\D/g, '')
  if (stripped.startsWith('0'))  return `254${stripped.slice(1)}`
  if (stripped.startsWith('254')) return stripped
  if (stripped.startsWith('7') || stripped.startsWith('1')) return `254${stripped}`
  return stripped
}

// ── STK Push ──────────────────────────────────────────────
export async function initiateStkPush(params: {
  phone:       string
  amount:      number
  accountRef:  string   // e.g. sale number or patient name
  description: string
  saleId?:     string   // to track in callback
}): Promise<{
  checkoutRequestId: string
  responseCode:      string
  responseDesc:      string
}> {
  const token            = await getAccessToken()
  const { password, timestamp } = generatePassword()
  const phone            = normalizePhone(params.phone)
  const amount           = Math.ceil(params.amount)    // M-Pesa requires integer

  const body = {
    BusinessShortCode: SHORTCODE,
    Password:          password,
    Timestamp:         timestamp,
    TransactionType:   'CustomerPayBillOnline',
    Amount:            amount,
    PartyA:            phone,
    PartyB:            SHORTCODE,
    PhoneNumber:       phone,
    CallBackURL:       CALLBACK_URL,
    AccountReference:  params.accountRef.slice(0, 12),  // max 12 chars
    TransactionDesc:   params.description.slice(0, 13), // max 13 chars
  }

  const response = await axios.post(
    `${DARAJA_BASE}/mpesa/stkpush/v1/processrequest`,
    body,
    { headers: { Authorization: `Bearer ${token}` } },
  )

  const { CheckoutRequestID, ResponseCode, ResponseDescription } = response.data

  // Store pending STK request in Redis (5 min TTL)
  if (params.saleId) {
    await redis.setex(
      `mpesa:stk:${CheckoutRequestID}`,
      300,
      JSON.stringify({ saleId: params.saleId, amount, phone }),
    )
  }

  logger.info({ checkoutRequestId: CheckoutRequestID, phone, amount }, 'STK Push initiated')

  return {
    checkoutRequestId: CheckoutRequestID,
    responseCode:      ResponseCode,
    responseDesc:      ResponseDescription,
  }
}

// ── Parse STK callback ─────────────────────────────────────
export interface MpesaCallbackResult {
  checkoutRequestId: string
  resultCode:        number            // 0 = success
  resultDesc:        string
  mpesaReceiptNo?:   string
  amount?:           number
  phone?:            string
  transactionDate?:  string
}

export function parseStkCallback(body: any): MpesaCallbackResult {
  const stk    = body?.Body?.stkCallback
  const code   = stk?.ResultCode
  const items  = stk?.CallbackMetadata?.Item ?? []

  const get = (name: string) =>
    items.find((i: any) => i.Name === name)?.Value

  return {
    checkoutRequestId: stk?.CheckoutRequestID,
    resultCode:        code,
    resultDesc:        stk?.ResultDesc,
    mpesaReceiptNo:    get('MpesaReceiptNumber'),
    amount:            get('Amount'),
    phone:             get('PhoneNumber')?.toString(),
    transactionDate:   get('TransactionDate')?.toString(),
  }
}

// ── Query STK status (polling fallback) ───────────────────
export async function queryStkStatus(checkoutRequestId: string) {
  const token = await getAccessToken()
  const { password, timestamp } = generatePassword()

  const response = await axios.post(
    `${DARAJA_BASE}/mpesa/stkpushquery/v1/query`,
    {
      BusinessShortCode: SHORTCODE,
      Password:          password,
      Timestamp:         timestamp,
      CheckoutRequestID: checkoutRequestId,
    },
    { headers: { Authorization: `Bearer ${token}` } },
  )

  return response.data
}