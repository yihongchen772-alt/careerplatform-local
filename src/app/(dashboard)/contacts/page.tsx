import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { ContactList } from "@/components/contacts/contact-list";
import { ReferralVaultCard } from "@/components/contacts/referral-vault-card";
import { readReferralVault } from "@/lib/referral-vault";
import { PageHero } from "@/components/layout/page-hero";
import { Users } from "lucide-react";

export default async function ContactsPage() {
  const user = await requireUser();

  const [contacts, allPositions, allApplications, profileRow] = await Promise.all([
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
    db.user.findUnique({
      where: { id: user.id },
      select: { applicationProfile: true },
    }),
  ]);
  const referralCodes = readReferralVault(profileRow?.applicationProfile);

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
      <PageHero title="联系人与内推码" icon={Users} description="HR、内推人、面试官与内推码保险箱——群聊内推文案一键入库，网申自动填入对应公司内推码" />
      <ReferralVaultCard initialCodes={referralCodes} />
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
