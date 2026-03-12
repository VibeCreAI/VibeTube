import type { LanguageCode } from '@/lib/constants/languages';

export type RecordingPromptMode = 'script' | 'custom';

export const VOICE_SAMPLE_SCRIPTS: Record<LanguageCode, string> = {
  en: 'Good stories feel personal because each voice carries rhythm, emotion, and detail. I am recording this sample in a calm, natural tone so the model can capture clear pronunciation, steady pacing, and smooth expression across a full sentence.',
  zh: '好的声音样本应该清晰、自然、稳定，让模型听到真实的语气、节奏和停顿。我现在用平稳的速度朗读这段文字，希望它能学习我的发音特点、情绪变化，以及一句完整表达里的轻重缓急。',
  ja: '良い音声サンプルは、発音の明瞭さだけでなく、間の取り方や感情の流れも自然に含まれています。私は今、落ち着いた話し方でこの文章を読み、声の響き、速度、抑揚が伝わるようにしています。',
  ko: '좋은 음성 샘플은 발음만 또렷한 것이 아니라 말의 리듬과 감정의 흐름도 자연스럽게 담겨야 합니다. 저는 지금 차분한 속도로 이 문장을 읽으면서 제 목소리의 울림, 억양, 그리고 표현의 변화를 분명하게 전달하고 있습니다.',
  de: 'Eine gute Sprachprobe sollte nicht nur deutlich sein, sondern auch natürlich klingen und einen gleichmäßigen Rhythmus haben. Ich lese diesen Text in ruhigem Tempo vor, damit das Modell meine Aussprache, Betonung und die feinen Nuancen meiner Stimme zuverlässig erfassen kann.',
  fr: 'Un bon échantillon de voix doit être clair, naturel et régulier, afin que le modèle entende la prononciation, le rythme et les variations d’émotion. Je lis ce texte d’une voix posée pour montrer le timbre, l’intonation et la fluidité de mon expression.',
  ru: 'Хороший голосовой образец должен быть не только разборчивым, но и естественным по темпу, интонации и подаче. Сейчас я читаю этот текст спокойно и ровно, чтобы модель уловила особенности моего произношения, ритма речи и эмоциональных оттенков.',
  pt: 'Uma boa amostra de voz precisa soar clara, natural e constante, para que o modelo perceba a pronúncia, o ritmo e as mudanças sutis de emoção. Estou lendo este texto com calma para mostrar o timbre da minha voz, a entonação e a fluidez da fala.',
  es: 'Una buena muestra de voz debe sonar clara, natural y estable, para que el modelo pueda captar la pronunciación, el ritmo y los cambios sutiles de emoción. Estoy leyendo este texto con calma para mostrar el tono, la entonación y la fluidez de mi voz.',
  it: 'Un buon campione vocale deve essere chiaro, naturale e costante, così il modello può riconoscere pronuncia, ritmo e sfumature emotive. Sto leggendo questo testo con calma per mostrare il timbro della mia voce, l’intonazione e la fluidità del parlato.',
};

export function getVoiceSampleScript(language: LanguageCode): string {
  return VOICE_SAMPLE_SCRIPTS[language];
}
