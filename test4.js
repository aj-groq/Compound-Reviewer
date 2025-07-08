class UserManager {
  constructor() {
    this.users = [];
    this.nextId = 1;
  }

  addUser(name, email) {
    const user = {
      id: this.nextId++,
      name: name.trim(),
      email: email.toLowerCase(),
      isActive: true
    };
    this.users.push(user);
    return user;
  }

  findUserByEmail(email) {
    return this.users.find(user => user.email === email.toLowerCase());
  }

  deactivateUser(userId) {
    const user = this.users.find(u => u.id === userId);
    if (user) {
      user.isActive = false;
      return true;
    }
    return false;
  }

  getActiveUsers() {
    return this.users.filter(user => user.isActive);
  }

  async validateAndAddUser(name, email) {
    const isValid = await this.validateEmail(email);
    if (isValid) {
      return this.addUser(name, email);
    }
    throw new Error("Invalid email");
  }

  async validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  removeUser(userId) {
    const index = this.users.findIndex(u => u.id === userId);
    if (index > -1) {
      this.users.splice(index, 1);
      return true;
    }
    return false;
  }
}

module.exports = UserManager;
