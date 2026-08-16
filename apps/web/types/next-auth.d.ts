import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      plan: string;
      role: string;
      status: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }

  interface User {
    id: string;
    plan: string;
    role: string;
    status: string;
  }
}