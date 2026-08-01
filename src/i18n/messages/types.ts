export type PluralForms = {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
};

export type PluralMessage = {
  readonly _kind: "plural";
  readonly forms: PluralForms;
};

export type MessageLeaf = string | PluralMessage;

export const plural = <const Forms extends PluralForms>(
  forms: Forms,
): { readonly _kind: "plural"; readonly forms: Forms } => ({
  _kind: "plural",
  forms,
});

export type MessageShape<Canonical> = Canonical extends string
  ? string
  : Canonical extends PluralMessage
    ? PluralMessage
    : Canonical extends Record<string, unknown>
      ? { [Key in keyof Canonical]: MessageShape<Canonical[Key]> }
      : never;

type Join<Prefix extends string, Key extends string> = Prefix extends ""
  ? Key
  : `${Prefix}.${Key}`;

export type MessagePath<Tree, Prefix extends string = ""> = {
  [Key in keyof Tree & string]: Tree[Key] extends MessageLeaf
    ? Join<Prefix, Key>
    : Tree[Key] extends Record<string, unknown>
      ? MessagePath<Tree[Key], Join<Prefix, Key>>
      : never;
}[keyof Tree & string];
