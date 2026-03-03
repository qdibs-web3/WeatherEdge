import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { createToken } from "../auth/jwt";
import bcrypt from "bcrypt";

export const authRouter = router({
  // Register with email + password
  register: publicProcedure
    .input(z.object({
      email: z.string().email(),
      password: z.string().min(8),
      name: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const existing = await db.getUserByEmail(input.email);
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "Email already registered." });
      const passwordHash = await bcrypt.hash(input.password, 12);
      const user = await db.createUser({ email: input.email, name: input.name, passwordHash });
      if (!user) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const token = createToken({ userId: user.id, email: user.email });
      return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
    }),

  // Login with email + password
  login: publicProcedure
    .input(z.object({ email: z.string().email(), password: z.string() }))
    .mutation(async ({ input }) => {
      const user = await db.getUserByEmail(input.email);
      if (!user?.passwordHash) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password." });
      const valid = await bcrypt.compare(input.password, user.passwordHash);
      if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid email or password." });
      await db.updateUser(user.id, { lastLoginAt: new Date() });
      const token = createToken({ userId: user.id, email: user.email });
      return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role } };
    }),

  // Get current user
  me: protectedProcedure.query(async ({ ctx }) => {
    return { id: ctx.user.id, email: ctx.user.email, name: ctx.user.name, role: ctx.user.role, avatarUrl: ctx.user.avatarUrl };
  }),

  // Update password
  updatePassword: protectedProcedure
    .input(z.object({ currentPassword: z.string(), newPassword: z.string().min(8) }))
    .mutation(async ({ ctx, input }) => {
      const user = await db.getUserById(ctx.user.id);
      if (!user?.passwordHash) throw new TRPCError({ code: "BAD_REQUEST" });
      const valid = await bcrypt.compare(input.currentPassword, user.passwordHash);
      if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "Current password is incorrect." });
      const passwordHash = await bcrypt.hash(input.newPassword, 12);
      await db.updateUser(ctx.user.id, { passwordHash });
      return { success: true };
    }),
});
