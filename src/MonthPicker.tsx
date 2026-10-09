import { useState } from 'react';
import { Dialog, Icon, Label } from './ui';

export function MonthPicker({
  value,
  current,
  onChange,
}: {
  value: string;
  current: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(value.slice(0, 4));
  const yearNumber = Number(year);
  const validYear = /^\d{1,4}$/.test(year) && yearNumber >= 1 && yearNumber <= 9999;
  const choose = (month: number) => {
    onChange(`${String(yearNumber).padStart(4, '0')}-${String(month).padStart(2, '0')}`);
    setOpen(false);
  };
  const shift = (delta: number) => {
    const index = Number(value.slice(0, 4)) * 12 + Number(value.slice(5)) - 1 + delta;
    onChange(
      `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`,
    );
  };
  return (
    <>
      <div className="month-picker">
        <button
          className="icon-button"
          aria-label="上一个月"
          disabled={value === '0001-01'}
          onClick={() => shift(-1)}
        >
          <Icon name="left" size={18} />
        </button>
        <button
          className="month-trigger"
          aria-label="选择年月"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => {
            setYear(value.slice(0, 4));
            setOpen(true);
          }}
        >
          <Icon name="calendar" size={17} />
          <span className="month-label">
            {value.slice(0, 4)}年{Number(value.slice(5))}月
          </span>
          <Icon name="down" size={15} />
        </button>
        <button
          className="icon-button"
          aria-label="下一个月"
          disabled={value === '9999-12'}
          onClick={() => shift(1)}
        >
          <Icon name="right" size={18} />
        </button>
      </div>
      {open && (
        <Dialog title="选择年月" compact onClose={() => setOpen(false)}>
          <p className="dialog-copy">直接输入年份，再点选月份。</p>
          <div className="year-controls">
            <button
              className="icon-button"
              aria-label="上一年"
              disabled={!validYear || yearNumber === 1}
              onClick={() => setYear(String(yearNumber - 1))}
            >
              <Icon name="left" />
            </button>
            <Label title="年份">
              <input
                aria-label="年份"
                type="number"
                inputMode="numeric"
                min={1}
                max={9999}
                step={1}
                value={year}
                onChange={(e) => setYear(e.target.value)}
              />
            </Label>
            <button
              className="icon-button"
              aria-label="下一年"
              disabled={!validYear || yearNumber === 9999}
              onClick={() => setYear(String(yearNumber + 1))}
            >
              <Icon name="right" />
            </button>
          </div>
          {!validYear && <p role="alert">请输入 1 至 9999 的整数年份</p>}
          <div className="month-grid" role="group" aria-label="月份">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
              <button
                key={month}
                disabled={!validYear}
                aria-pressed={
                  yearNumber === Number(value.slice(0, 4)) && month === Number(value.slice(5))
                }
                onClick={() => choose(month)}
              >
                {month}月
              </button>
            ))}
          </div>
          <button
            className="secondary wide"
            onClick={() => {
              onChange(current);
              setOpen(false);
            }}
          >
            回到本月
          </button>
        </Dialog>
      )}
    </>
  );
}
