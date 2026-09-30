const BOND_ART: Record<string, string> = {
  ah: "austria_hungary",
  ita: "italy",
  fra: "france",
  uk: "britain",
  ger: "germany",
  rus: "russia",
};

export function bondSrc(nationId: string, interest: number): string {
  return `/art/bond_${BOND_ART[nationId] ?? nationId}_${interest}.png`;
}
