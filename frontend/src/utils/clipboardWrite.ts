// 클립보드 쓰기 공용 유틸(stage-49 F-2, 규약 C·D 공유) — 폰은 `http://<PC-IP>:8000`처럼
// 비보안 컨텍스트(non-HTTPS)로 접속하는 경우가 있고, 이때 `navigator.clipboard`가 존재하지
// 않거나 `writeText`가 거부될 수 있다. 그래서 성공 여부를 boolean으로 돌려주고, 실패/부재 시
// `document.execCommand('copy')` 폴백까지 시도한 뒤에만 최종 실패를 알린다.
export async function writeClipboardText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 비보안 컨텍스트·권한 거부 등 — 아래 폴백으로 계속
    }
  }

  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}
