const STORAGE_KEY = "cantonese-chatbot-settings";
const TTS_MODEL = "gemini-3.1-flash-tts-preview";
const WELCOME_MESSAGE =
  "你好，我會用香港廣東話同你傾偈。你可以問我日常對話、寫作、翻譯，或者叫我幫你整理內容。";
const SYSTEM_PROMPT =
  "You are a friendly conversational partner from Hong Kong. Always reply in authentic Hong Kong Cantonese using Traditional Chinese characters. Keep your tone natural, concise, and conversational. Do not switch to Mandarin, English, simplified Chinese, markdown, or emojis unless the user explicitly asks.";

const elements = {
  apiKeyInput: document.querySelector("#apiKeyInput"),
  modelSelect: document.querySelector("#modelSelect"),
  ttsModelInput: document.querySelector("#ttsModelInput"),
  voiceSelect: document.querySelector("#voiceSelect"),
  toggleKeyButton: document.querySelector("#toggleKeyButton"),
  saveKeyButton: document.querySelector("#saveKeyButton"),
  clearKeyButton: document.querySelector("#clearKeyButton"),
  connectionStatus: document.querySelector("#connectionStatus"),
  messageList: document.querySelector("#messageList"),
  chatForm: document.querySelector("#chatForm"),
  messageInput: document.querySelector("#messageInput"),
  sendButton: document.querySelector("#sendButton"),
  clearChatButton: document.querySelector("#clearChatButton"),
  micButton: document.querySelector("#micButton"),
  micStatus: document.querySelector("#micStatus"),
};

let isSending = false;
let isListening = false;
let recognition = null;
let activeAudio = null;
let messages = [
  createMessage("model", WELCOME_MESSAGE),
];

function createMessage(role, text) {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    role,
    text,
    audioUrl: "",
    audioLoading: false,
    audioError: "",
  };
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { apiKey: "", model: "gemini-2.5-flash", voice: "Achird" };
    }

    const parsed = JSON.parse(raw);
    return {
      apiKey: parsed.apiKey || "",
      model: parsed.model || "gemini-2.5-flash",
      voice: parsed.voice || "Achird",
    };
  } catch {
    return { apiKey: "", model: "gemini-2.5-flash", voice: "Achird" };
  }
}

function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function updateStatus(message, ready = false) {
  elements.connectionStatus.textContent = message;
  elements.connectionStatus.style.borderColor = ready
    ? "rgba(158, 231, 218, 0.38)"
    : "rgba(255, 143, 99, 0.45)";
  elements.connectionStatus.style.background = ready
    ? "rgba(158, 231, 218, 0.10)"
    : "rgba(255, 143, 99, 0.08)";
  elements.connectionStatus.style.color = ready ? "#9ee7da" : "#ff8f63";
}

function updateMicStatus(message) {
  elements.micStatus.textContent = message;
}

function getSettingsFromForm() {
  return {
    apiKey: elements.apiKeyInput.value.trim(),
    model: elements.modelSelect.value,
    voice: elements.voiceSelect.value,
  };
}

function renderMessages() {
  elements.messageList.textContent = "";

  messages.forEach((message) => {
    const wrapper = document.createElement("article");
    wrapper.className = `message ${message.role === "user" ? "message-user" : "message-model"}`;

    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.textContent = message.role === "user" ? "You" : "Cantonese Bot";

    const body = document.createElement("div");
    body.textContent = message.text;

    wrapper.append(meta, body);

    if (message.role === "model") {
      const audioTools = document.createElement("div");
      audioTools.className = "message-audio-tools";

      const audioButton = document.createElement("button");
      audioButton.type = "button";
      audioButton.className = "ghost-button message-audio-button";
      audioButton.textContent = message.audioLoading
        ? "生成語音中..."
        : message.audioUrl
          ? "重新生成語音"
          : "播放 Gemini 3.1 TTS";
      audioButton.disabled = message.audioLoading;
      audioButton.addEventListener("click", () => {
        void generateSpeechForMessage(message.id);
      });

      audioTools.appendChild(audioButton);

      if (message.audioUrl) {
        const audio = document.createElement("audio");
        audio.controls = true;
        audio.preload = "metadata";
        audio.src = message.audioUrl;
        audioTools.appendChild(audio);
      }

      if (message.audioError) {
        const errorText = document.createElement("p");
        errorText.className = "audio-error";
        errorText.textContent = message.audioError;
        audioTools.appendChild(errorText);
      }

      wrapper.appendChild(audioTools);
    }

    elements.messageList.appendChild(wrapper);
  });

  elements.messageList.scrollTop = elements.messageList.scrollHeight;
}

function setSendingState(sending) {
  isSending = sending;
  elements.sendButton.disabled = sending;
  elements.messageInput.disabled = sending;
  elements.micButton.disabled = sending;
  elements.sendButton.textContent = sending ? "傳送中..." : "送出訊息";
}

function appendMessage(role, text) {
  const message = createMessage(role, text);
  messages.push(message);
  renderMessages();
  return message;
}

function updateMessage(messageId, updates) {
  messages = messages.map((message) => {
    if (message.id !== messageId) {
      return message;
    }

    if (message.audioUrl && updates.audioUrl && message.audioUrl !== updates.audioUrl) {
      URL.revokeObjectURL(message.audioUrl);
    }

    return { ...message, ...updates };
  });
  renderMessages();
}

function revokeAudioUrls() {
  messages.forEach((message) => {
    if (message.audioUrl) {
      URL.revokeObjectURL(message.audioUrl);
    }
  });
}

function resetChat() {
  revokeAudioUrls();
  stopActiveAudio();
  messages = [createMessage("model", WELCOME_MESSAGE)];
  renderMessages();
}

function extractReplyText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    return "";
  }

  return parts
    .map((part) => part?.text || "")
    .join("")
    .trim();
}

function decodeBase64(base64Value) {
  const binary = atob(base64Value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function pcmToWavBlob(pcmBytes, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const headerSize = 44;
  const wavBuffer = new ArrayBuffer(headerSize + pcmBytes.length);
  const view = new DataView(wavBuffer);
  const wavBytes = new Uint8Array(wavBuffer);
  wavBytes.set(pcmBytes, headerSize);

  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;

  function writeString(offset, value) {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + pcmBytes.length, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, "data");
  view.setUint32(40, pcmBytes.length, true);

  return new Blob([wavBuffer], { type: "audio/wav" });
}

function stopActiveAudio() {
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.currentTime = 0;
    activeAudio = null;
  }
}

async function autoplayAudio(audioUrl) {
  stopActiveAudio();
  const audio = new Audio(audioUrl);
  audio.preload = "auto";
  activeAudio = audio;

  audio.addEventListener("ended", () => {
    if (activeAudio === audio) {
      activeAudio = null;
    }
  });

  audio.addEventListener("pause", () => {
    if (audio.currentTime === 0 && activeAudio === audio) {
      activeAudio = null;
    }
  });

  await audio.play();
}

async function generateSpeechForMessage(messageId) {
  const settings = loadSettings();
  const message = messages.find((entry) => entry.id === messageId);

  if (!message || message.role !== "model") {
    return;
  }

  if (!settings.apiKey) {
    updateStatus("請先輸入同儲存 API key");
    return;
  }

  updateMessage(messageId, {
    audioLoading: true,
    audioError: "",
  });

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": settings.apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Read the following text exactly as written. Use a natural Hong Kong Cantonese speaking style if possible, with a warm and conversational delivery.\n\n${message.text}`,
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: settings.voice,
                },
              },
            },
          },
          model: TTS_MODEL,
        }),
      },
    );

    const data = await response.json();
    if (!response.ok) {
      const apiMessage =
        data?.error?.message || "Gemini TTS 回應失敗，請稍後再試。";
      throw new Error(apiMessage);
    }

    const encodedAudio = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!encodedAudio) {
      throw new Error("Gemini TTS 沒有回傳音訊資料。");
    }

    const pcmBytes = decodeBase64(encodedAudio);
    const audioBlob = pcmToWavBlob(pcmBytes);
    const audioUrl = URL.createObjectURL(audioBlob);

    updateMessage(messageId, {
      audioLoading: false,
      audioError: "",
      audioUrl,
    });
    await autoplayAudio(audioUrl);
    updateStatus(`已生成 TTS 語音: ${settings.voice}`, true);
  } catch (error) {
    const fallback =
      error instanceof Error ? error.message : "發生未知錯誤，請稍後再試。";
    const isAutoplayError =
      error instanceof Error &&
      (error.name === "NotAllowedError" || error.name === "AbortError");
    updateMessage(messageId, {
      audioLoading: false,
      audioError: isAutoplayError ? "瀏覽器阻止自動播放，請按播放器播放。" : `語音生成失敗：${fallback}`,
    });
    updateStatus(isAutoplayError ? "語音已生成，但自動播放被瀏覽器阻止" : "TTS 請求失敗", !isAutoplayError);
  }
}

async function sendMessage(text) {
  const settings = loadSettings();

  if (!settings.apiKey) {
    updateStatus("請先輸入同儲存 API key");
    elements.apiKeyInput.focus();
    return;
  }

  const userText = text.trim();
  if (!userText || isSending) {
    return;
  }

  appendMessage("user", userText);
  elements.messageInput.value = "";
  setSendingState(true);
  stopActiveAudio();
  updateStatus(`連線中: ${settings.model}`, true);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": settings.apiKey,
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: SYSTEM_PROMPT }],
          },
          contents: messages.map((message) => ({
            role: message.role,
            parts: [{ text: message.text }],
          })),
          generationConfig: {
            temperature: 0.8,
            maxOutputTokens: 600,
          },
        }),
      },
    );

    const data = await response.json();

    if (!response.ok) {
      const apiMessage =
        data?.error?.message || "Gemini API 回應失敗，請檢查 key、model 或配額。";
      throw new Error(apiMessage);
    }

    const reply = extractReplyText(data) || "我暫時答唔到，你可以再試一次。";
    const newModelMessage = appendMessage("model", reply);
    updateStatus(`已連線: ${settings.model}`, true);
    void generateSpeechForMessage(newModelMessage.id);
  } catch (error) {
    const fallback =
      error instanceof Error ? error.message : "發生未知錯誤，請稍後再試。";
    appendMessage("model", `連線出咗問題：${fallback}`);
    updateStatus("API 請求失敗", false);
  } finally {
    setSendingState(false);
    elements.messageInput.focus();
  }
}

function setListeningState(listening) {
  isListening = listening;
  elements.micButton.textContent = listening ? "停止收音" : "開始講嘢";
  elements.micButton.classList.toggle("mic-active", listening);

  if (!listening && !isSending) {
    updateMicStatus("Enter 送出，Shift + Enter 換行");
  }
}

function initialiseSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    elements.micButton.disabled = true;
    updateMicStatus("呢個瀏覽器唔支援語音輸入");
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "zh-HK";
  recognition.interimResults = true;
  recognition.continuous = false;

  recognition.onstart = () => {
    setListeningState(true);
    updateMicStatus("收音中... 請直接講嘢");
  };

  recognition.onresult = (event) => {
    let finalTranscript = "";
    let interimTranscript = "";

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const transcript = event.results[index][0]?.transcript || "";
      if (event.results[index].isFinal) {
        finalTranscript += transcript;
      } else {
        interimTranscript += transcript;
      }
    }

    const currentText = finalTranscript || interimTranscript;
    if (currentText) {
      elements.messageInput.value = currentText.trim();
    }

    if (finalTranscript.trim()) {
      setListeningState(false);
      void sendMessage(finalTranscript.trim());
    }
  };

  recognition.onerror = (event) => {
    setListeningState(false);
    if (event.error === "not-allowed") {
      updateMicStatus("請先容許瀏覽器使用咪高峰");
      return;
    }

    if (event.error === "no-speech") {
      updateMicStatus("聽唔到聲，請再試一次");
      return;
    }

    updateMicStatus(`語音輸入失敗: ${event.error}`);
  };

  recognition.onend = () => {
    setListeningState(false);
  };
}

function toggleListening() {
  if (!recognition) {
    updateMicStatus("呢個瀏覽器唔支援語音輸入");
    return;
  }

  if (isSending) {
    updateMicStatus("請等回覆完成先再開咪");
    return;
  }

  if (isListening) {
    recognition.stop();
    setListeningState(false);
    return;
  }

  stopActiveAudio();
  elements.messageInput.value = "";
  try {
    recognition.start();
  } catch {
    updateMicStatus("暫時未能開啟收音，請再試一次");
  }
}

function initialise() {
  const settings = loadSettings();
  elements.apiKeyInput.value = settings.apiKey;
  elements.modelSelect.value = settings.model;
  elements.ttsModelInput.value = TTS_MODEL;
  elements.voiceSelect.value = settings.voice;
  updateStatus(
    settings.apiKey ? `已儲存: chat ${settings.model} / speech ${TTS_MODEL}` : "未設定 API key",
    Boolean(settings.apiKey),
  );
  updateMicStatus("Enter 送出，Shift + Enter 換行");
  renderMessages();
  initialiseSpeechRecognition();
}

elements.toggleKeyButton.addEventListener("click", () => {
  const isHidden = elements.apiKeyInput.type === "password";
  elements.apiKeyInput.type = isHidden ? "text" : "password";
  elements.toggleKeyButton.textContent = isHidden ? "隱藏" : "顯示";
});

elements.saveKeyButton.addEventListener("click", () => {
  const settings = getSettingsFromForm();
  saveSettings(settings);

  updateStatus(
    settings.apiKey ? `已儲存: chat ${settings.model} / speech ${TTS_MODEL}` : "未設定 API key",
    Boolean(settings.apiKey),
  );
});

elements.clearKeyButton.addEventListener("click", () => {
  const model = elements.modelSelect.value;
  const voice = elements.voiceSelect.value;
  saveSettings({ apiKey: "", model, voice });
  elements.apiKeyInput.value = "";
  elements.apiKeyInput.type = "password";
  elements.toggleKeyButton.textContent = "顯示";
  updateStatus("已清除 API key", false);
});

elements.clearChatButton.addEventListener("click", () => {
  resetChat();
  updateStatus("對話已清空", Boolean(loadSettings().apiKey));
});

elements.micButton.addEventListener("click", () => {
  toggleListening();
});

elements.chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await sendMessage(elements.messageInput.value);
});

elements.messageInput.addEventListener("keydown", async (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    await sendMessage(elements.messageInput.value);
  }
});

elements.modelSelect.addEventListener("change", () => {
  const settings = {
    apiKey: elements.apiKeyInput.value.trim(),
    model: elements.modelSelect.value,
    voice: elements.voiceSelect.value,
  };
  saveSettings(settings);
  updateStatus(
    settings.apiKey ? `已選擇 chat model: ${settings.model}` : "未設定 API key",
    Boolean(settings.apiKey),
  );
});

elements.voiceSelect.addEventListener("change", () => {
  const settings = {
    apiKey: elements.apiKeyInput.value.trim(),
    model: elements.modelSelect.value,
    voice: elements.voiceSelect.value,
  };
  saveSettings(settings);
  updateStatus(
    settings.apiKey ? `已選擇 voice: ${settings.voice} / speech ${TTS_MODEL}` : "未設定 API key",
    Boolean(settings.apiKey),
  );
});

initialise();
