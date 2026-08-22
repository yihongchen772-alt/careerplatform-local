import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { registerSchema } from "@/lib/validation";

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = registerSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "输入无效" },
      { status: 400 }
    );
  }

  const { email, password, name, school, targetTrack, graduationYear } =
    parsed.data;

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "该邮箱已注册" },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await db.user.create({
    data: {
      email,
      passwordHash,
      name,
      school,
      targetTrack,
      graduationYear,
    },
  });

  return NextResponse.json({ ok: true });
}
