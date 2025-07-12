from groq import Groq
import os

client = Groq(api_key=os.getenv("GROQ_API_KEY"))
completion = client.chat.completions.create(
    model="llama2-70b-4096",
    messages=[
      {
        "role": "user",
        "content": "Say hello!"
      }
    ],
    temperature=1,
    max_completion_tokens=1024,
    top_p=1,
    stop=None,
)

for chunk in completion:
    print(chunk.choices[0].delta.content or "", end="")
