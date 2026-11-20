type JumpToAsking = (encHost: string) => void;

let impl: JumpToAsking | null = null;

export function registerAttentionJump(fn: JumpToAsking): () => void {
  if (impl !== null) {
    throw new Error(
      "attentionNav: a second useAttention tried to register the jump seam — there is exactly one attention owner",
    );
  }
  impl = fn;
  return () => {
    impl = null;
  };
}

export function jumpToAsking(encHost: string): void {
  if (!impl) {
    throw new Error(
      "attentionNav: jumpToAsking called before useAttention registered it",
    );
  }
  impl(encHost);
}
