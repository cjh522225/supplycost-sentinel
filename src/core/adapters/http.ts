export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 SupplyCostSentinel/1.0'

export interface FetchOptions {
  timeoutMs?: number
  retries?: number
  headers?: Record<string, string>
  signal?: AbortSignal
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function request(url: string, opts: FetchOptions = {}): Promise<Response> {
  const { timeoutMs = 25000, retries = 3, headers = {}, signal } = opts
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const onAbort = () => controller.abort()
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': DEFAULT_USER_AGENT,
          Accept: '*/*',
          ...headers
        },
        signal: controller.signal,
        redirect: 'follow'
      })
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
      return response
    } catch (error) {
      lastError = error
      if (attempt < retries) await sleep(400 * (attempt + 1))
    } finally {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const response = await request(url, opts)
  const buffer = await response.arrayBuffer()
  return new TextDecoder('utf-8').decode(buffer)
}

export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  const response = await request(url, {
    ...opts,
    headers: { Accept: 'application/json, text/plain, */*', ...(opts.headers ?? {}) }
  })
  return (await response.json()) as T
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

export function absoluteUrl(href: string, base: string): string {
  try {
    return new URL(href, base).toString()
  } catch {
    return href
  }
}
