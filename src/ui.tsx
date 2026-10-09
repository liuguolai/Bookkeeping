import { useEffect, useRef, type ReactNode } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Wallet,
  Plus,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
  SlidersHorizontal,
  BarChart3,
  Settings,
  BookOpen,
  Target,
  Utensils,
  TrainFront,
  ShoppingBag,
  House,
  Zap,
  Heart,
  GraduationCap,
  Gamepad2,
  Plane,
  Gift,
  Ellipsis,
  Award,
  BriefcaseBusiness,
  ShieldCheck,
  Archive,
  FileDown,
  Download,
  Upload,
  Trash2,
  RotateCcw,
  Pencil,
  Check,
  CircleHelp,
  Info,
  ArrowRight,
  FolderOpen,
  CalendarDays,
  Coins,
  LockKeyhole,
  Coffee,
  ReceiptText,
  Pin,
  ChevronUp,
  HandHeart,
  Baby,
  HeartHandshake,
  PawPrint,
  Package,
  Shirt,
  Sparkles,
  Dumbbell,
  Smartphone,
  Car,
  Laptop,
  type LucideIcon,
} from 'lucide-react';
const icons: Record<string, LucideIcon> = {
  wallet: Wallet,
  plus: Plus,
  x: X,
  down: ChevronDown,
  left: ChevronLeft,
  right: ChevronRight,
  search: Search,
  filter: SlidersHorizontal,
  stats: BarChart3,
  settings: Settings,
  book: BookOpen,
  target: Target,
  utensils: Utensils,
  train: TrainFront,
  shopping: ShoppingBag,
  home: House,
  bolt: Zap,
  heart: Heart,
  education: GraduationCap,
  game: Gamepad2,
  plane: Plane,
  gift: Gift,
  dots: Ellipsis,
  award: Award,
  briefcase: BriefcaseBusiness,
  shield: ShieldCheck,
  archive: Archive,
  export: FileDown,
  download: Download,
  upload: Upload,
  trash: Trash2,
  refund: RotateCcw,
  edit: Pencil,
  check: Check,
  help: CircleHelp,
  info: Info,
  arrow: ArrowRight,
  folder: FolderOpen,
  calendar: CalendarDays,
  coins: Coins,
  lock: LockKeyhole,
  coffee: Coffee,
  receipt: ReceiptText,
  income: ArrowDownLeft,
  expense: ArrowUpRight,
  pin: Pin,
  up: ChevronUp,
  elder: HandHeart,
  baby: Baby,
  partner: HeartHandshake,
  pet: PawPrint,
  package: Package,
  shirt: Shirt,
  sparkles: Sparkles,
  fitness: Dumbbell,
  phone: Smartphone,
  car: Car,
  laptop: Laptop,
};
export const categoryIcons = [
  ['dots', '其他'],
  ['utensils', '餐饮'],
  ['coffee', '咖啡'],
  ['shopping', '购物'],
  ['train', '交通'],
  ['home', '居家'],
  ['bolt', '水电'],
  ['heart', '健康'],
  ['education', '学习'],
  ['game', '娱乐'],
  ['plane', '旅行'],
  ['gift', '礼物'],
  ['briefcase', '工作'],
  ['award', '奖金'],
  ['wallet', '钱包'],
  ['coins', '零钱'],
  ['book', '书籍'],
  ['receipt', '账单'],
  ['shield', '保险'],
  ['target', '目标'],
  ['elder', '长辈'],
  ['baby', '小孩'],
  ['partner', '伴侣'],
  ['pet', '宠物'],
  ['package', '日用品'],
  ['shirt', '服饰'],
  ['sparkles', '护理'],
  ['fitness', '健身'],
  ['phone', '通讯'],
  ['car', '车辆'],
  ['laptop', '数码'],
] as const;
export function Icon({
  name,
  size = 20,
  className = '',
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const Component = icons[name] ?? Ellipsis;
  return <Component size={size} strokeWidth={1.7} className={className} aria-hidden="true" />;
}
export function Dialog({
  title,
  children,
  onClose,
  compact = false,
  className = '',
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  compact?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const root = ref.current!;
    const viewport = () => {
      const view = window.visualViewport;
      root.parentElement?.style.setProperty('height', `${view?.height ?? window.innerHeight}px`);
      root.parentElement?.style.setProperty('top', `${view?.offsetTop ?? 0}px`);
    };
    viewport();
    window.visualViewport?.addEventListener('resize', viewport);
    window.visualViewport?.addEventListener('scroll', viewport);
    const back = (e: Event) => {
      if (Array.from(document.querySelectorAll('[role="dialog"]')).at(-1) !== root) return;
      e.preventDefault();
      close.current();
    };
    document.addEventListener('ledger-back', back);
    const timer = setTimeout(() => {
      // Preserve React autoFocus and any field the user has already focused.
      if (root.contains(document.activeElement)) return;
      const target =
        root.querySelector<HTMLElement>('[autofocus], input:not([type="file"])') ??
        root.querySelector<HTMLElement>('button, select');
      target?.focus({ preventScroll: true });
    }, 50);
    const key = (e: KeyboardEvent) => {
      if (Array.from(document.querySelectorAll('[role="dialog"]')).at(-1) !== root) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        close.current();
      }
      if (e.key === 'Tab') {
        const focusable = Array.from(
          root.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
          ),
        ).filter((x) => x.offsetParent !== null);
        const first = focusable[0],
          last = focusable.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('ledger-back', back);
      window.visualViewport?.removeEventListener('resize', viewport);
      window.visualViewport?.removeEventListener('scroll', viewport);
      document.body.style.overflow = old;
      document.removeEventListener('keydown', key);
      // A replacement dialog may already have focused its amount field during commit.
      const active = document.activeElement;
      if (
        !(active instanceof Element) ||
        !active.closest('[role="dialog"]') ||
        root.contains(active)
      ) {
        previous?.focus();
      }
    };
  }, []);
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`dialog ${compact ? 'compact' : ''} ${className}`}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="关闭弹窗" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function Empty({
  title,
  detail,
  action,
  icon = 'receipt',
}: {
  title: string;
  detail: string;
  icon?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-art">
        <Icon name={icon} size={36} />
        <span className="spark">✦</span>
      </div>
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}
export function Label({
  title,
  children,
  hint,
}: {
  title: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{title}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
