import requests
import os

api_key = os.getenv('GROQ_API_KEY')
if not api_key:
    raise ValueError("GROQ_API_KEY environment variable is not set")

def call_groq_api(prompt):
    url = "https://api.groq.com/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer api_key",
        "Content-Type": "application/json"
    }
    data = {
        "model": "llama2-70b-4096",
        "prompt": prompt,
        "max_tokens": 50
    }
    response = requests.post(url, headers=headers, json=data)
    return response.json()

if __name__ == "__main__":
    print(call_groq_api("Say hello!")) 