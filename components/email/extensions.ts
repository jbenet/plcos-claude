import { Node, mergeAttributes } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { safeHref } from '@/lib/email/doc';

/**
 * The email editor's schema (docs/25 §Editor), apart from the component so the properties can build
 * it in Node and check it against lib/email/doc.ts: no node or mark the email schema lacks.
 */

/** A picture in the text is one of this draft's attachments, shown from its own address. */
export const EmailImage = Node.create({
  name: 'emailImage',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return { attachmentId: { default: null }, alt: { default: '' } };
  },
  // Nothing parses into it: a picture pasted from a web page is dropped, never fetched.
  parseHTML() { return []; },
  renderHTML({ HTMLAttributes }) {
    const id = String(HTMLAttributes.attachmentId ?? '');
    return ['img', mergeAttributes({ src: `/api/email/attachment?id=${encodeURIComponent(id)}`, alt: HTMLAttributes.alt ?? '', 'data-attachment': id })];
  },
});

export const EMAIL_EXTENSIONS = [
  StarterKit.configure({
    blockquote: false, code: false, codeBlock: false, heading: false, horizontalRule: false, strike: false, underline: false,
    link: { openOnClick: false, autolink: true, defaultProtocol: 'https', isAllowedUri: (url) => safeHref(url) !== null },
  }),
  EmailImage,
];
