"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { updateProfile } from "@/lib/actions/account";

export function ProfileForm({
  initial,
}: {
  initial: {
    name: string | null;
    school: string | null;
    targetTrack: string | null;
    graduationYear: number | null;
    skills: string | null;
    preferredCities: string | null;
    expectedSalaryMin: number | null;
  };
}) {
  const [name, setName] = useState(initial.name ?? "");
  const [school, setSchool] = useState(initial.school ?? "");
  const [targetTrack, setTargetTrack] = useState(initial.targetTrack ?? "");
  const [graduationYear, setGraduationYear] = useState(
    initial.graduationYear?.toString() ?? ""
  );
  const [skills, setSkills] = useState(initial.skills ?? "");
  const [preferredCities, setPreferredCities] = useState(
    initial.preferredCities ?? ""
  );
  const [expectedSalaryMin, setExpectedSalaryMin] = useState(
    initial.expectedSalaryMin?.toString() ?? ""
  );
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await updateProfile({
        name: name || undefined,
        school: school || undefined,
        targetTrack: targetTrack || undefined,
        graduationYear: graduationYear ? Number(graduationYear) : undefined,
        skills: skills || undefined,
        preferredCities: preferredCities || undefined,
        expectedSalaryMin: expectedSalaryMin
          ? Number(expectedSalaryMin)
          : undefined,
      });
      toast.success("已保存");
    } catch {
      toast.error("保存失败，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>个人资料</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">昵称</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">学校</Label>
              <Input value={school} onChange={(e) => setSchool(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">求职方向</Label>
              <Input
                value={targetTrack}
                onChange={(e) => setTargetTrack(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">毕业年份</Label>
              <Input
                type="number"
                value={graduationYear}
                onChange={(e) => setGraduationYear(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-3 rounded-md border bg-muted/30 p-3">
            <div>
              <p className="text-sm font-medium">求职偏好</p>
              <p className="text-xs text-muted-foreground">
                AI 给候选岗位打分时会拿这些跟 JD 对照，填得越具体分数越准
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                擅长的技术栈 / 技能
              </Label>
              <Textarea
                value={skills}
                onChange={(e) => setSkills(e.target.value)}
                rows={2}
                placeholder="例如：Java、Spring Boot、MySQL、Redis，做过分布式项目"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">期望城市</Label>
                <Input
                  value={preferredCities}
                  onChange={(e) => setPreferredCities(e.target.value)}
                  placeholder="北京、上海、杭州"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  期望月薪下限（K）
                </Label>
                <Input
                  type="number"
                  value={expectedSalaryMin}
                  onChange={(e) => setExpectedSalaryMin(e.target.value)}
                  placeholder="20"
                />
              </div>
            </div>
          </div>

          <Button type="submit" disabled={loading}>
            {loading ? "保存中..." : "保存资料"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
