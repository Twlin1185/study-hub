// 공통 fetch 래퍼 — 설계 §3 API 공통 규약
// Base URL: /api (같은 origin). 에러 포맷: { error: { code, message, detail } }

export interface ApiErrorBody {
  error: {
    code: 'VALIDATION_ERROR' | 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL' | string
    message: string
    detail?: unknown
  }
}

export class ApiError extends Error {
  code: string
  detail: unknown
  status: number

  constructor(status: number, body: ApiErrorBody) {
    super(body.error?.message ?? `요청 실패 (HTTP ${status})`)
    this.name = 'ApiError'
    this.status = status
    this.code = body.error?.code ?? 'INTERNAL'
    this.detail = body.error?.detail ?? null
  }
}

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  size: number
}

const BASE_URL = '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // FormData는 브라우저가 boundary 포함 Content-Type을 직접 설정해야 하므로 강제 지정하지 않는다.
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })

  if (res.status === 204) {
    return undefined as T
  }

  const isJson = res.headers.get('content-type')?.includes('application/json')
  const body = isJson ? await res.json() : undefined

  if (!res.ok) {
    throw new ApiError(res.status, body as ApiErrorBody)
  }

  return body as T
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: data !== undefined ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PATCH', body: data !== undefined ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PUT', body: data !== undefined ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  // multipart/form-data 전용 (예: import/preview의 파일 업로드)
  postForm: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
}
