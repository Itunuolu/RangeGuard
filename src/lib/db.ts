type PrismaClientLike = {
  user: {
    upsert: (args: unknown) => Promise<{ id: string }>;
  };
  pool?: {
    upsert: (args: unknown) => Promise<{ id: string }>;
  };
  strategy: {
    create: (args: unknown) => Promise<unknown>;
  };
  position?: {
    upsert: (args: unknown) => Promise<{ id: string }>;
  };
  positionEvent?: {
    upsert: (args: unknown) => Promise<unknown>;
  };
  botPolicy?: {
    upsert: (args: unknown) => Promise<{ id: string }>;
  };
  botAction?: {
    upsert: (args: unknown) => Promise<unknown>;
  };
};

declare global {
  var rangeGuardPrisma: PrismaClientLike | undefined;
}

export async function getPrismaClient(): Promise<PrismaClientLike | null> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return null;

  if (globalThis.rangeGuardPrisma) return globalThis.rangeGuardPrisma;

  try {
    const prismaModule = (await import("@prisma/client")) as unknown as {
      PrismaClient: new (options?: unknown) => PrismaClientLike;
    };
    const adapterModule = (await import("@prisma/adapter-pg")) as unknown as {
      PrismaPg: new (options: { connectionString: string }) => unknown;
    };
    const adapter = new adapterModule.PrismaPg({ connectionString: databaseUrl });
    globalThis.rangeGuardPrisma = new prismaModule.PrismaClient({ adapter });
    return globalThis.rangeGuardPrisma;
  } catch {
    return null;
  }
}
