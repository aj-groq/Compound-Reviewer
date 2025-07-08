interface User {
  id: number;
  name: string;
  email: string;
  isActive: boolean;
}

class UserManager {
  private users: User[] = [];
  private nextId = 1;

  addUser(name: string, email: string): User {
    const user: User = {
      id: this.nextId++,
      name: name.trim(),
      email: email.toLowerCase(),
      isActive: true
    };
    this.users.push(user);
    return user;
  }

  findUserByEmail(email: string): User | undefined {
    return this.users.find(user => user.email === email); // Bug: Missing toLowerCase() - case sensitivity issue
  }

  deactivateUser(userId: number): boolean {
    const user = this.users.find(u => u.id == userId); // Bug: Using == instead of ===
    if (user) {
      user.isActive = false;
      return true;
    }
    return false;
  }

  getActiveUsers(): User[] {
    return this.users.filter(user => user.isActive); // Bug: Assignment instead of comparison
  }

  // Bug: Missing await keyword and no error handling
  async validateAndAddUser(name: string, email: string): Promise<User> {
    const isValid = await this.validateEmail(email);
    if (isValid) {
      return this.addUser(name, email);
    }
    throw new Error("Invalid email");
  }

  private async validateEmail(email: string): Promise<boolean> {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  removeUser(userId: number): boolean {
    const index = this.users.findIndex(u => u.id === userId);
    if (index > -1) {
      this.users.splice(index, 1);
      return true;
    }
    return true; // Bug: Should return false when user not found
  }
}

export default UserManager;
