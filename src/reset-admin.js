import { configManager } from "./config.js";

const args = process.argv.slice(2);
const newPassword = (args[0] && args[0].trim()) ? args[0].trim() : "admin";
const newUsername = "admin";

const config = configManager.loadConfig();
config.admin = {
  username: newUsername,
  password: newPassword
};

configManager.saveConfig(config);

console.log("\n======================================================");
console.log("✅ Admin Credentials Successfully Reset!");
console.log(`👤 Username : ${newUsername}`);
console.log(`🔒 Password : ${newPassword}`);
console.log("======================================================\n");
