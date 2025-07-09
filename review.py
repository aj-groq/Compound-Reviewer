import os
import asyncio
from groq import Groq
from livekit import api

class APIIntegrationBot:
    def __init__(self):
        self.groq_client = Groq(api_key=os.environ.get('GROQ_API_KEY'))
        self.livekit_api = api.LiveKitAPI(
            url=os.environ.get('LIVEKIT_URL'),
            api_key=os.environ.get('LIVEKIT_API_KEY'),
            api_secret=os.environ.get('LIVEKIT_API_SECRET')
        )
    
    async def generate_content(self, prompt: str) -> str:
        """Generate content using Groq API"""
        response = self.groq_client.chat.completions.create(
            model="llama3-8b-8192",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=300
        )
        return response.choices[0].message.content
    
    async def create_live_session(self, topic: str) -> dict:
        """Create LiveKit session for real-time collaboration"""
        room_name = f"session-{hash(topic) % 10000}"
        
        # Create room
        room = await self.livekit_api.room.create_room(
            api.CreateRoomRequest(name=room_name, max_participants=10)
        )
        
        # Generate AI content for the session
        ai_content = await self.generate_content(f"Create a brief overview about: {topic}")
        
        return {
            "room_id": room.name,
            "session_url": f"{os.environ.get('LIVEKIT_URL')}/room/{room.name}",
            "ai_content": ai_content,
            "topic": topic
        }

# Quick demo
async def demo():
    bot = APIIntegrationBot()
    session = await bot.create_live_session("Python async programming")
    print(f"Session created: {session['room_id']}")
    print(f"AI Content: {session['ai_content'][:100]}...")

if __name__ == "__main__":
    asyncio.run(demo())

