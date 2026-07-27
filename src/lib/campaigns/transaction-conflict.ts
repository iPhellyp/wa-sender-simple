import { Prisma } from "@prisma/client";

export const MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS = 3;

export function isSerializableTransactionConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}
