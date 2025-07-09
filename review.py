import json
import hashlib
import time
from typing import Dict, List, Optional
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta

@dataclass
class Task:
    id: str
    title: str
    description: str
    priority: int  # 1-5, where 5 is highest
    status: str  # 'pending', 'in_progress', 'completed', 'cancelled'
    created_at: datetime
    due_date: Optional[datetime] = None
    tags: List[str] = None
    
    def __post_init__(self):
        if self.tags is None:
            self.tags = []

class TaskManager:
    def __init__(self, storage_file: str = "tasks.json"):
        self.storage_file = storage_file
        self.tasks: Dict[str, Task] = {}
        self.load_tasks()
    
    def generate_task_id(self, title: str) -> str:
        """Generate a unique task ID based on title and timestamp"""
        timestamp = str(time.time())
        return hashlib.md5(f"{title}{timestamp}".encode()).hexdigest()[:8]
    
    def create_task(self, title: str, description: str, priority: int = 3, due_date: Optional[datetime] = None, tags: List[str] = None) -> Task:
        if not (1 <= priority <= 5):
            raise ValueError("Priority must be between 1 and 5")
        
        task_id = self.generate_task_id(title)
        task = Task(
            id=task_id,
            title=title,
            description=description,
            priority=priority,
            status='pending',
            created_at=datetime.now(),
            due_date=due_date,
            tags=tags or []
        )
        
        self.tasks[task_id] = task
        self.save_tasks()
        return task
    
    def update_task_status(self, task_id: str, status: str) -> bool:
        """Update task status"""
        valid_statuses = ['pending', 'in_progress', 'completed', 'cancelled']
        if status not in valid_statuses:
            raise ValueError(f"Invalid status. Must be one of: {valid_statuses}")
        
        if task_id in self.tasks:
            self.tasks[task_id].status = status
            self.save_tasks()
            return True
        return False
    
    def get_tasks_by_priority(self, min_priority: int = 1) -> List[Task]:
        """Get tasks filtered by minimum priority level"""
        return [task for task in self.tasks.values() 
                if task.priority >= min_priority and task.status != 'completed']
    
    def get_overdue_tasks(self) -> List[Task]:
        """Get tasks that are past their due date"""
        now = datetime.now()
        return [task for task in self.tasks.values() 
                if task.due_date and task.due_date < now and task.status != 'completed']
    
    def search_tasks(self, query: str) -> List[Task]:
        """Search tasks by title, description, or tags"""
        query = query.lower()
        results = []
        
        for task in self.tasks.values():
            if (query in task.title.lower() or 
                query in task.description.lower() or 
                any(query in tag.lower() for tag in task.tags)):
                results.append(task)
        
        return results
    
    def get_task_statistics(self) -> Dict[str, int]:
        """Get statistics about tasks"""
        stats = {
            'total': len(self.tasks),
            'pending': 0,
            'in_progress': 0,
            'completed': 0,
            'cancelled': 0,
            'overdue': len(self.get_overdue_tasks())
        }
        
        for task in self.tasks.values():
            stats[task.status] += 1
        
        return stats
    
    def save_tasks(self):
        """Save tasks to JSON file"""
        try:
            serializable_tasks = {}
            for task_id, task in self.tasks.items():
                task_dict = asdict(task)
                # Convert datetime objects to ISO strings
                task_dict['created_at'] = task.created_at.isoformat()
                if task.due_date:
                    task_dict['due_date'] = task.due_date.isoformat()
                serializable_tasks[task_id] = task_dict
            
            with open(self.storage_file, 'w') as f:
                json.dump(serializable_tasks, f, indent=2)
        except Exception as e:
            print(f"Error saving tasks: {e}")
    
    def load_tasks(self):
        """Load tasks from JSON file"""
        try:
            with open(self.storage_file, 'r') as f:
                data = json.load(f)
            
            for task_id, task_data in data.items():
                # Convert ISO strings back to datetime objects
                task_data['created_at'] = datetime.fromisoformat(task_data['created_at'])
                if task_data.get('due_date'):
                    task_data['due_date'] = datetime.fromisoformat(task_data['due_date'])
                
                self.tasks[task_id] = Task(**task_data)
        except FileNotFoundError:
            print(f"No existing task file found. Starting fresh.")
        except Exception as e:
            print(f"Error loading tasks: {e}")

# Demo usage
def demo():
    tm = TaskManager()
    
    # Create some sample tasks
    task1 = tm.create_task(
        "Implement user authentication", 
        "Add login/logout functionality with JWT tokens",
        priority=5,
        due_date=datetime.now() + timedelta(days=3),
        tags=["backend", "security", "urgent"]
    )
    
    task2 = tm.create_task(
        "Write unit tests",
        "Create comprehensive test suite for API endpoints",
        priority=4,
        tags=["testing", "quality"]
    )
    
    task3 = tm.create_task(
        "Update documentation",
        "Refresh API documentation and add examples",
        priority=2,
        due_date=datetime.now() + timedelta(days=7),
        tags=["documentation"]
    )
    
    # Update task status
    tm.update_task_status(task2.id, 'in_progress')
    
    # Display statistics
    stats = tm.get_task_statistics()
    print("Task Statistics:")
    for key, value in stats.items():
        print(f"  {key.replace('_', ' ').title()}: {value}")
    
    # Show high priority tasks
    print("\nHigh Priority Tasks (4+):")
    for task in tm.get_tasks_by_priority(4):
        print(f"  [{task.priority}] {task.title} - {task.status}")
    
    # Search example
    print("\nTasks containing 'test':")
    for task in tm.search_tasks('test'):
        print(f"  {task.title}")

if __name__ == '__main__':
    demo()