/**
 * WebOrient Synchronized Show & Describe Engine (`src/sdk/speech-sync.js`)
 * Ensures "showing & saying are 100% in sync" like a live human salesperson:
 * - Coordinates Ghost Cursor arrival, visual spotlight/caption, and voice narration beat-by-beat
 * - Supports native Web Speech API (`window.speechSynthesis`) in the user's preferred language
 *   (English, Hindi, Hinglish, Spanish, French) AND Gemini Live 24kHz audio playback gating
 * - Emits word/sentence boundary events so the cursor can perform micro-emphases while speaking
 */
export class SpeechSyncEngine {
  constructor(options = {}) {
    this.memory = options.memory || null;
    this.onSpeechStart = options.onSpeechStart || (() => {});
    this.onSpeechWord = options.onSpeechWord || (() => {});
    this.onSpeechEnd = options.onSpeechEnd || (() => {});
    this.isSpeaking = false;
    this.muted = false;
    this._currentUtterance = null;
    this._resolveCurrentSpeech = null;
  }

  /**
   * Speaks `text` in the user's native language and resolves ONLY when the spoken line completes,
   * keeping cursor movements and page transitions locked in step with speech.
   */
  async speakSynchronized(text, options = {}) {
    if (!text) return;
    this.stop();

    const langConfig = this.memory ? this.memory.getLanguageConfig() : { voiceLang: 'en-IN', fallbackLang: 'en-US' };
    const targetLang = options.lang || langConfig.voiceLang || 'en-IN';

    this.isSpeaking = true;
    this.onSpeechStart(text, targetLang);

    // If muted or speechSynthesis unavailable, simulate natural reading cadence (~55ms per char)
    if (this.muted || typeof window === 'undefined' || !('speechSynthesis' in window)) {
      const readingMs = Math.min(4200, Math.max(1100, text.length * 42));
      await new Promise(r => {
        this._resolveCurrentSpeech = r;
        setTimeout(r, readingMs);
      });
      this.isSpeaking = false;
      this.onSpeechEnd(text);
      return;
    }

    return new Promise(resolve => {
      this._resolveCurrentSpeech = resolve;
      let finished = false;

      const finish = () => {
        if (finished) return;
        finished = true;
        this.isSpeaking = false;
        this._currentUtterance = null;
        this._resolveCurrentSpeech = null;
        this.onSpeechEnd(text);
        resolve();
      };

      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        this._currentUtterance = utterance;

        const voices = window.speechSynthesis.getVoices() || [];
        const matchedVoice =
          voices.find(v => v.lang === targetLang) ||
          voices.find(v => v.lang.startsWith(targetLang.split('-')[0])) ||
          voices.find(v => v.lang.startsWith(langConfig.fallbackLang?.split('-')[0] || 'en')) ||
          voices[0];

        if (matchedVoice) {
          utterance.voice = matchedVoice;
          utterance.lang = matchedVoice.lang;
        } else {
          utterance.lang = targetLang;
        }

        utterance.rate = options.rate || 1.04;
        utterance.pitch = options.pitch || 1.0;

        utterance.onboundary = (event) => {
          if (event.name === 'word') {
            this.onSpeechWord(event.charIndex, text);
          }
        };

        utterance.onend = finish;
        utterance.onerror = finish;

        // Safety watchdog in case browser TTS hangs on background tab
        const maxTimeout = Math.min(12000, Math.max(2200, text.length * 85));
        setTimeout(finish, maxTimeout);

        window.speechSynthesis.speak(utterance);
      } catch (_) {
        finish();
      }
    });
  }

  /**
   * Immediately halts any active speech (for user barge-in or tour cancellation)
   */
  stop() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) {}
    }
    this.isSpeaking = false;
    this._currentUtterance = null;
    if (this._resolveCurrentSpeech) {
      const r = this._resolveCurrentSpeech;
      this._resolveCurrentSpeech = null;
      r();
    }
  }
}

/**
 * Multilingual Salesperson Script Dictionary
 * Provides localized "Show & Describe Simultaneously" salesperson lines in:
 * - English (`en-IN` / `en-US`)
 * - Hinglish (`hinglish` — natural Indian startup salesperson blend)
 * - Hindi (`hi-IN`)
 * - Spanish (`es-ES`)
 */
export const SALESPERSON_SCRIPTS = {
  'en-IN': {
    hero: (goal) => `Welcome! I see your goal is "${goal}". Let me show you our live telemetry—310 millisecond voice latency and a 42 percent lift in form conversions.`,
    workflow: () => `Here is how our 4-stage closed-loop engine works. Watch as I swap to the Bézier Actuation tab while explaining it.`,
    navFeatures: () => `Now let's head over to the Architecture page so I can show you the 5-layer engine and latency benchmarks.`,
    featuresTab: () => `We are now on the Architecture page, and I remember we already covered the overview. Let's inspect Layer 2: our 60fps Cubic Bézier Ghost Cursor.`,
    featuresSwipe: () => `Let me swipe through our industry deployment blueprints so you can see real production use cases.`,
    navPricing: () => `Next, let's jump to the Pricing and ROI Calculator page to model your exact conversion lift.`,
    pricingToggle: () => `Watch me flip the billing switch to Annual—that immediately saves you 20 percent, bringing Pro Co-Pilot down to 64 dollars a month.`,
    pricingRoi: () => `I'm setting your monthly traffic slider to 75,000 visitors—generating an estimated 108,000 dollars per month in additional revenue.`,
    navContact: () => `Finally, let's go to the Enterprise Intake page and fill out your consultation form automatically using your remembered profile.`,
    contactFill: (name, company) => `I am filling in your details for ${name} at ${company}, selecting Next.js and Pro Co-Pilot, and enabling Priority Onboarding.`,
    contactDone: () => `All 11 fields are filled and validated, while your password field stayed completely untouched. Shall I submit this for you?`
  },
  'hinglish': {
    hero: (goal) => `Namaste! Aapka goal hai "${goal}". Dekhiye yahan live metrics mein—sirf 310 millisecond latency hai aur form conversion 42 percent badh jata hai.`,
    workflow: () => `Ab dekhiye hamara 4-stage engine kaise kaam karta hai—main saath-saath tab switch karke aapko Bézier Cursor dikha raha hoon.`,
    navFeatures: () => `Chaliye ab Architecture page par chalte hain jahan main aapko 5-layer runtime aur benchmarks dikhaunga.`,
    featuresTab: () => `Hum Architecture page par aa gaye hain, aur mujhe yaad hai humne overview dekh liya hai. Yeh dekhiye Layer 2: 60fps Cubic Bézier Ghost Cursor.`,
    featuresSwipe: () => `Main is carousel ko swipe kar raha hoon taaki aap FinTech aur E-Commerce use cases dekh sakein.`,
    navPricing: () => `Ab chaliye Pricing aur ROI Calculator page par chalte hain aapki savings calculate karne ke liye.`,
    pricingToggle: () => `Dekhiye, maine Annual billing switch on kar diya—isse aapko seedha 20 percent discount milta hai aur Pro plan 64 dollars per month ho gaya.`,
    pricingRoi: () => `Main traffic slider ko 75,000 visitors par set kar रहा hoon—jisse har mahine lagbhag 108,000 dollars ki extra revenue lift milti hai.`,
    navContact: () => `Ab aakhri step mein Enterprise Contact page par chalte hain aur aapka form automatically fill karte hain.`,
    contactFill: (name, company) => `Main ${name} aur ${company} ki details type kar raha hoon, Next.js aur Pro Co-Pilot select kiya, aur Priority Onboarding tick kar diya.`,
    contactDone: () => `Poora form fill aur validate ho gaya hai, aur password field bilkul safe hai. Kya main isse submit kar doon?`
  },
  'hi-IN': {
    hero: (goal) => `नमस्ते! आपका लक्ष्य "${goal}" है। यहाँ हमारे लाइव मेट्रिक्स देखिए—केवल 310 मिलीसेकंड की लेटेंसी और 42 प्रतिशत अधिक फॉर्म कन्वर्ज़न।`,
    workflow: () => `यहाँ देखिए हमारा 4-स्टेज इंजन कैसे काम करता है। मैं बोलते हुए साथ में टैब बदल कर आपको दिखा रहा हूँ।`,
    navFeatures: () => `चलिए अब आर्किटेक्चर पेज पर चलते हैं जहाँ हम 5-लेयर इंजन और बेंचमार्क देखेंगे।`,
    featuresTab: () => `हम आर्किटेक्चर पेज पर आ गए हैं। हमें याद है कि हमने होम पेज देख लिया है, अब लेयर 2 का घोस्ट कर्सर देखिए।`,
    featuresSwipe: () => `मैं इस कैरोसेल को स्वाइप कर रहा हूँ ताकि आप अलग-अलग इंडस्ट्री के उदाहरण देख सकें।`,
    navPricing: () => `अब प्राइसिंग और आरओआई कैलकुलेटर पेज पर चलते हैं।`,
    pricingToggle: () => `देखिए, मैंने एनुअल बिलिंग स्विच ऑन कर दिया है—इससे आपको तुरंत 20 प्रतिशत की बचत मिलती है।`,
    pricingRoi: () => `मैं ट्रैफ़िक स्लाइडर को 75,000 विज़िटर्स पर सेट कर रहा हूँ, जिससे हर महीने बड़ी रेवेन्यू वृद्धि होती है।`,
    navContact: () => `अब कॉन्टैक्ट पेज पर चलते हैं और आपकी याद रखी गई जानकारी से पूरा फॉर्म भरते हैं।`,
    contactFill: (name, company) => `मैं ${name} और ${company} का विवरण भर रहा हूँ, और सभी विकल्प चुन रहा हूँ।`,
    contactDone: () => `सभी फ़ील्ड भर दिए गए हैं और पासवर्ड सुरक्षित है। क्या मैं इसे सबमिट कर दूँ?`
  },
  'es-ES': {
    hero: (goal) => `¡Bienvenido! Veo que tu objetivo es "${goal}". Mira nuestras métricas en vivo: 310 milisegundos de latencia y un 42 por ciento más de conversión.`,
    workflow: () => `Así funciona nuestro motor de 4 etapas. Observa cómo cambio a la pestaña del cursor Bézier mientras te lo explico.`,
    navFeatures: () => `Ahora vayamos a la página de Arquitectura para mostrarte las 5 capas y las comparativas de velocidad.`,
    featuresTab: () => `Ya estamos en Arquitectura y recuerdo lo que vimos antes. Aquí tienes la Capa 2: nuestro Ghost Cursor a 60 cuadros por segundo.`,
    featuresSwipe: () => `Deslizaré este carrusel para mostrarte casos de uso en FinTech y comercio electrónico.`,
    navPricing: () => `Vamos a la página de Precios y Calculadora ROI para calcular tu retorno de inversión.`,
    pricingToggle: () => `Mira cómo activo la facturación anual: ahorras un 20 por ciento al instante, dejando el plan Pro en 64 dólares al mes.`,
    pricingRoi: () => `Ajusto el deslizador a 75,000 visitantes mensuales, proyectando 108,000 dólares adicionales por mes.`,
    navContact: () => `Por último, vayamos a la página de Contacto Empresarial para completar tu formulario automáticamente.`,
    contactFill: (name, company) => `Estoy rellenando los datos de ${name} en ${company}, seleccionando Next.js y el plan Pro.`,
    contactDone: () => `Los 11 campos están listos y validados. ¿Te gustaría que envíe el formulario ahora?`
  }
};
