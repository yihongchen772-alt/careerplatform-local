import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { ContactList } from "@/components/contacts/contact-list";

export default async function ContactsPage() {
  const user = await requireUser();

  const [contacts, allPositions, allApplications] = await Promise.all([
    db.contact.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    }),
    db.position.findMany({
      where: { userId: user.id },
      include: { company: true },
    }),
    db.application.findMany({
      where: { userId: user.id },
      include: { company: true },
    }),
  ]);

  const positionOptions = allPositions.map((p) => ({
    id: p.id,
    label: `候选：${p.company.name} · ${p.title}`,
  }));
  const applicationOptions = allApplications.map((a) => ({
    id: a.id,
    label: `投递：${a.company.name} · ${a.title}`,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">联系人</h1>
        <p className="text-sm text-muted-foreground">
          HR、内推人、面试官——记下谁、怎么联系、什么时候该跟进，到日子会提醒你
        </p>
      </div>
      <ContactList
        contacts={contacts.map((c) => ({
          id: c.id,
          name: c.name,
          role: c.role,
          companyName: c.companyName,
          contactInfo: c.contactInfo,
          note: c.note,
          nextFollowUpAt: c.nextFollowUpAt?.toISOString() ?? null,
          lastContactedAt: c.lastContactedAt?.toISOString() ?? null,
          positionId: c.positionId,
          applicationId: c.applicationId,
        }))}
        positions={positionOptions}
        applications={applicationOptions}
      />
    </div>
  );
}
