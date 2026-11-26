import assert from "node:assert/strict";
import { test } from "node:test";
import { linkHost, MAX_ITEMS, parseWishlist, wishlistText } from "../src/lib/wishlist.js";

test("one idea per line, blank lines dropped", () => {
  assert.deepEqual(parseWishlist("Socks\n\n  A scarf  \r\n"), [
    { text: "Socks", link: null },
    { text: "A scarf", link: null },
  ]);
});

test("a link anywhere in a line is lifted out, with the separator before it", () => {
  assert.deepEqual(parseWishlist("Boots - https://shop.example/boots"), [{ text: "Boots", link: "https://shop.example/boots" }]);
  assert.deepEqual(parseWishlist("https://shop.example/x: the blue one"), [{ text: "the blue one", link: "https://shop.example/x" }]);
  assert.deepEqual(parseWishlist("HTTPS://Shop.Example/a"), [{ text: "", link: "https://shop.example/a" }]);
});

test("only http(s) is ever a link", () => {
  assert.deepEqual(parseWishlist("javascript:alert(1)"), [{ text: "javascript:alert(1)", link: null }]);
});

test("too many ideas, or one too long, is refused", () => {
  assert.ok("error" in parseWishlist(Array.from({ length: MAX_ITEMS + 1 }, (_, i) => `idea ${i}`).join("\n")));
  assert.ok("error" in parseWishlist("x".repeat(201)));
  assert.equal((parseWishlist(`${"x".repeat(200)} https://ok.example`) as unknown[]).length, 1, "the link doesn't count toward the limit");
});

test("a saved list round-trips through the textarea unchanged", () => {
  const items = parseWishlist("Boots https://shop.example/boots\nSocks\nhttps://shop.example/only") as ReturnType<typeof parseWishlist>;
  assert.deepEqual(parseWishlist(wishlistText(items as never)), items);
});

test("a link is labelled by its host", () => {
  assert.equal(linkHost("https://shop.example/a/b?c=d"), "shop.example");
});

test("sentence punctuation after a link stays with the text", () => {
  assert.deepEqual(parseWishlist("(like https://shop.example/a)."), [{ text: "(like ).", link: "https://shop.example/a" }]);
  assert.deepEqual(parseWishlist("Wiki https://en.example/Foo_(bar)"), [{ text: "Wiki", link: "https://en.example/Foo_(bar)" }]);
});
