export const NOTE_COLORS = ["cream", "sage", "blush", "blue", "lavender", "sand"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export const NOTE_PALETTE: Record<NoteColor, { label: string; background: string; border: string; ink: string }> = {
  cream: { label: "奶油白", background: "#f5f0e7", border: "#ded5c5", ink: "#514b43" },
  sage: { label: "鼠尾草绿", background: "#e6ece4", border: "#c8d4c6", ink: "#3f5147" },
  blush: { label: "雾粉", background: "#f1e6e5", border: "#dec9c8", ink: "#604c50" },
  blue: { label: "烟雨蓝", background: "#e4ebef", border: "#c7d5dc", ink: "#42535d" },
  lavender: { label: "灰紫", background: "#ece8f0", border: "#d2cbdc", ink: "#504b5d" },
  sand: { label: "燕麦米", background: "#ece6dc", border: "#d6cbbd", ink: "#544d44" },
};
