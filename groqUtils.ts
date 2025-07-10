import { Groq } from 'groq-sdk'

const groq = new Groq()

export async function analyzeImageWithGroq(base64Data: string, label: string) {
  const dataUrl = `data:image/png;base64,${base64Data}`
  const chatCompletion = await groq.chat.completions.create({
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": `Describe the user interface in this image. This is a screenshot of the ${label} homepage.`
          },
          {
            "type": "image_url",
            "image_url": {
              "url": dataUrl
            }
          }
        ]
      }
    ],
    "model": "meta-llama/llama-4-scout-17b-16e-instruct",
    "temperature": 1,
    "max_completion_tokens": 1024,
    "top_p": 1,
    "stream": false,
    "stop": null
  })
  console.log(`Groq response for ${label}:`, chatCompletion.choices[0].message.content)
} 