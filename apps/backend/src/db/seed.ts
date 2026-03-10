import "dotenv/config";
import bcrypt from "bcryptjs";
import { loadEnv } from "../config/env.js";
import { createDb } from "../config/database.js";
import { users, projects, userProjects } from "../models/index.js";

async function seed() {
  const env = loadEnv();
  const db = createDb(env);

  console.log("Seeding database...");

  const passwordHash = await bcrypt.hash("password123", 12);

  // Create users
  const [admin] = await db
    .insert(users)
    .values({
      email: "admin@ailancers.com",
      passwordHash,
      fullName: "Admin User",
      role: "admin",
      team: "Engineering",
    })
    .returning();

  const devs = await db
    .insert(users)
    .values([
      { email: "alice@ailancers.com", passwordHash, fullName: "Alice Johnson", role: "developer", team: "Frontend" },
      { email: "bob@ailancers.com", passwordHash, fullName: "Bob Smith", role: "developer", team: "Backend" },
      { email: "carol@ailancers.com", passwordHash, fullName: "Carol Williams", role: "developer", team: "Frontend" },
      { email: "dave@ailancers.com", passwordHash, fullName: "Dave Brown", role: "developer", team: "Backend" },
    ])
    .returning();

  // Create projects
  const [project1] = await db
    .insert(projects)
    .values([
      { name: "Main App", slug: "main-app", description: "The main application", monthlyBudgetUsd: "500" },
      { name: "API Service", slug: "api-service", description: "Backend API service", monthlyBudgetUsd: "300" },
    ])
    .returning();

  // Assign users to projects
  const allUsers = [admin, ...devs];
  for (const user of allUsers) {
    await db.insert(userProjects).values({ userId: user.id, projectId: project1.id });
  }

  console.log(`Created ${allUsers.length} users and 2 projects`);
  console.log("Admin login: admin@ailancers.com / password123");
  console.log("Dev login: alice@ailancers.com / password123");

  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
