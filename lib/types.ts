export type LangCode = 'en' | 'es'
export type Script = 'latin'

export interface Language {
  code: LangCode
  sttLocale: string      // BCP-47, for SpeechRecognition.lang
  label: string          // English name, for the picker
  nativeLabel: string    // native name
  translateAs: string    // phrase injected into the model prompt
  script: Script         // drives the typography class
}

export interface Participant {
  id: string
  name: string
  srcLang: LangCode
}

/** Broadcast over the wire. Contains no translation — each client makes its own. */
export interface Utterance {
  id: string             // stable across interim revisions
  speakerId: string
  speakerName: string
  srcLang: LangCode
  text: string
  isFinal: boolean
  ts: number             // client epoch ms at first emit
}

/** Local only. Never published. */
export interface RenderedUtterance extends Utterance {
  translation?: string
  translationState: 'none' | 'pending' | 'done' | 'failed'
}
