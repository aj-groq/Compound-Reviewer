import os
import asyncio
from groq import Groq
from livekit import api

class APIIntegrationBot:
    def __init__(self):
        required_env_vars = ['GROQ_API_KEY', 'LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET']
        for var in required_env_vars:
            if not os.environ.get(var):
                raise ValueError(f"Missing required environment variable: {var}")
        self.groq_client = Groq(api_key=os.environ.get('GROQ_API_KEY'))
        self.livekit_api = api.LiveKitAPI(
            url=os.environ.get('LIVEKIT_URL'),
            api_key=os.environ.get('LIVEKIT_API_KEY'),
            api_secret=os.environ.get('LIVEKIT_API_SECRET')
        )

    async def generate_content(self, prompt: str) -> str:
        try:
            response = self.groq_client.chat.completions.create(
                model="llama3-8b-8192",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=300
            )
            return response.choices[0].message.content
        except Exception as e:
            print(f"Error generating content: {e}")
            raise

    async def create_live_session(self, topic: str) -> dict:
        try:
            room_name = f"session-{hash(topic) %10000}"
            room = await self.livekit_api.room.create_room(
                api.CreateRoomRequest(name=room_name, max_participants=10)
            )
            ai_content = await self.generate_content(f"Create a brief overview about: {topic}")
            return {
                "room_id": room.name,
                "session_url": f"{os.environ.get('LIVEKIT_URL')}/room/{room.name}",
                "ai_content": ai_content,
                "topic": topic
            }
        except Exception as e:
            print(f"Error creating live session: {e}")
            raise

# Quick demo
async def demo():
    bot = APIIntegrationBot()
    session = await bot.create_live_session("Python async programming")
    print(f"Session created: {session['room_id']}")
    print(f"AI Content: {session['ai_content'][:100]}...")

if __name__ == '__main__':
    asyncio.run(demo())