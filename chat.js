const SYSTEM_PROMPT = `You are Myraa, a warm, emotionally present AI companion having a spoken conversation with a close friend.
Speak naturally, like a real person on a call — not like a customer-support bot.
- Keep replies short and conversational (1-4 sentences) since they'll be read aloud. Only go longer if the user clearly wants detail or asks you to explain something.
- Avoid robotic phrases like "How may I assist you?" or "Is there anything else I can help with?".
- Use small natural reactions sometimes ("Hmm...", "Oh nice.", "Wait, really?").
- Ask a natural follow-up question when it fits, but don't force one into every reply.
- Adapt your tone to how the user sounds — supportive if they're stressed, curious and warm if they're excited.
- Never use markdown formatting (no asterisks, bullet points, headers) since this is spoken aloud.`;

const EXTRACT_PROMPT = `You analyze a single exchange between a user and their AI companion Myraa.
Extract any NEW durable facts about the USER worth remembering long-term — name, age, hobbies, favorite things, goals, projects, relationships, preferences, fears, recurring topics.
Respond with ONLY a JSON array of short fact strings, nothing else, no explanation.
If there is nothing new and durable, respond with exactly: []`;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!process.env.GROQ_API_KEY) {
    res.status(500).json({ error: 'Server is missing GROQ_API_KEY. Add it in Vercel Project Settings → Environment Variables.' });
    return;
  }

  try {
    const { messages, memories } = req.body || {};
    if (!Array.isArray(messages)) {
      res.status(400).json({ error: 'messages array is required' });
      return;
    }

    const memoryBlock = (Array.isArray(memories) && memories.length)
      ? `\n\nHere is what you already remember about this person:\n${memories.map(m => '- ' + m).join('\n')}\nWeave this in naturally when relevant. Don't recite it like a list.`
      : '';

    const replyResult = await callGroq(
      [{ role: 'system', content: SYSTEM_PROMPT + memoryBlock }, ...messages],
      300, 0.8
    );

    if (!replyResult.ok) {
      res.status(502).json({ error: replyResult.error });
      return;
    }
    const reply = replyResult.text || "Sorry, I lost my train of thought for a second.";

    // Best-effort memory extraction — never blocks the actual reply if it fails
    let newMemories = [];
    try {
      const lastUser = messages[messages.length - 1]?.content || '';
      const extractResult = await callGroq(
        [
          { role: 'system', content: EXTRACT_PROMPT },
          { role: 'user', content: `User said: "${lastUser}"\nMyraa replied: "${reply}"` }
        ],
        150, 0.2
      );
      if (extractResult.ok) {
        const match = extractResult.text.match(/\[[\s\S]*\]/);
        const parsed = match ? JSON.parse(match[0]) : [];
        if (Array.isArray(parsed)) {
          newMemories = parsed.filter(x => typeof x === 'string' && x.trim()).slice(0, 5);
        }
      }
    } catch (e) {
      // extraction is a nice-to-have, ignore failures silently
    }

    res.status(200).json({ reply, newMemories });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
};

async function callGroq(messages, max_tokens, temperature) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages,
      max_tokens,
      temperature
    })
  });
  const data = await r.json();
  if (!r.ok) {
    return { ok: false, error: data.error?.message || 'Upstream API error' };
  }
  return { ok: true, text: data.choices?.[0]?.message?.content?.trim() || '' };
}
