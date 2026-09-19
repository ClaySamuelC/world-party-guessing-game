const FRAME_KEY = 'wp-frame-answers'

/** Local camera preference: fly to guess + answer after each reveal. */
export function getFrameAnswers(): boolean {
  try {
    return localStorage.getItem(FRAME_KEY) !== '0'
  } catch {
    return true
  }
}

export function setFrameAnswers(on: boolean) {
  try {
    localStorage.setItem(FRAME_KEY, on ? '1' : '0')
  } catch {
    /* ignore quota / private mode */
  }
}
