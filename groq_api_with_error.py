from groq import Groq
import os

try:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise ValueError("GROQ_API_KEY environment variable is not set")
    
    client = Groq(api_key=api_key)
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
        if chunk.choices and len(chunk.choices) > 0:
            content = chunk.choices[0].delta.content
            if content:
                print(content, end="")
                
except ValueError as e:
    print(f"Configuration error: {e}")
except Exception as e:
    print(f"An error occurred: {e}")
