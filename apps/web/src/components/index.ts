// The shared component library: anything that appears on more than one screen lives here. Screens extend a
// component with a (backwards-compatible) prop rather than forking it.
export { Button, ButtonLink, LinkButton, TextLink, buttonClass, type ButtonVariant } from './Button.tsx';
export { Seg, type SegItem } from './Seg.tsx';
export { DateInput, Field, FieldPair, FieldStack, MoneyInput, NumberInput, SearchInput, Select, TextInput, Textarea, Toggle } from './Field.tsx';
export { Chip, Dot, KV, Meta, Mono, NoteText, SectionLabel, Sub } from './Text.tsx';
export { Empty, ListHeader, ListRow, Pad, PadBody, PadHead } from './Pad.tsx';
export { Docket, DocketHead, DocketSection, PausedNotice, RowActions, SavedNotice, StatusLine, type DocketClose } from './Docket.tsx';
export { Banner, Notice } from './Banner.tsx';
export { Loading, LoadingHead, loadingText, useLoadingText } from './Loading.tsx';
export { InkSwatch, InkWedge, PAPER_TONE, PaperSwatch, type PaperSwatchProps, type SwatchSize } from './Swatches.tsx';
export { RadioList, RadioOption } from './RadioList.tsx';
export { PaperPicker, PaperSelect, type PaperChoice, type PickablePaper } from './PaperPicker.tsx';
export { ItemLine, JobPaperLine, LedgerList, LevelBar, Money, PaperLine, PurchaseLine, StockLine, SummaryLine, WriteOffLine } from './Lines.tsx';
export { CostTable } from './CostTable.tsx';
export { PaperPurchaseForm, type PaperPurchaseDraft, type PaperPurchaseInitial, type PaperPurchaseSaved } from './PaperPurchaseForm.tsx';
export { Sweep, Spinner } from './Progress.tsx';
export { Fingerprint } from './Fingerprint.tsx';
