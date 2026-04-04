const DEFAULT_BASE_URL = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
const DEFAULT_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

function getHeaders() {
  const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY (or LLM_API_KEY).');
  }

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`
  };
}

function toChatMessages(history = []) {
  const messages = [
    {
      role: 'system',
      content:
        'You are SparkyPal Kernel AI. Respond succinctly, safely, and actionably. When uncertain, say what is missing.'
    }
  ];

  for (const item of history) {
    messages.push({ role: item.role, content: item.content });
  }

  return messages;
}

export async function generateChat({ history, model = DEFAULT_MODEL, temperature = 0.3 }) {
  const res = await fetch(`${DEFAULT_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      model,
      temperature,
      stream: false,
      messages: toChatMessages(history)
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LLM request failed: ${res.status} ${body}`);
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

export async function streamChat({ history, model = DEFAULT_MODEL, temperature = 0.3, onToken }) {
  const res = await fetch(`${DEFAULT_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      model,
      temperature,
      stream: true,
      messages: toChatMessages(history)
    })
  });

  if (!res.ok || !res.body) {
    const body = await res.text();
    throw new Error(`LLM stream failed: ${res.status} ${body}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      try {
        const json = JSON.parse(payload);
        const token = json?.choices?.[0]?.delta?.content || '';
        if (token) {
          fullText += token;
          onToken(token);
        }
      } catch {
        // Ignore non-JSON chunks.
      }
    }
  }

  return fullText.trim();
}
