import React from 'react';
import { Loader2, type LucideIcon } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'xs';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconPosition?: 'left' | 'right';
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'secondary',
      size = 'md',
      icon: Icon,
      iconPosition = 'left',
      loading = false,
      disabled,
      children,
      className = '',
      ...props
    },
    ref,
  ) => {
    const baseStyles =
      'inline-flex items-center justify-center font-medium rounded-[6px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed select-none';

    const sizeStyles: Record<ButtonSize, string> = {
      xs: 'h-6 px-2 text-[12px] gap-1.5',
      sm: 'h-7 px-2.5 text-[13px] gap-1.5',
      md: 'h-8 px-3.5 text-[14px] gap-2',
    };

    const variantStyles: Record<ButtonVariant, string> = {
      primary: 'bg-accent hover:bg-accent-hover text-accent-fg border border-transparent',
      secondary: 'bg-surface hover:bg-surface-subtle text-fg border border-border shadow-xs',
      ghost: 'bg-transparent hover:bg-surface-subtle text-fg border border-transparent',
      destructive:
        'bg-state-danger-bg hover:opacity-90 text-state-danger-fg border border-state-danger-border',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
        {...props}
      >
        {loading ? (
          <Loader2
            className="animate-spin shrink-0"
            size={size === 'xs' ? 12 : size === 'sm' ? 14 : 16}
            aria-hidden="true"
          />
        ) : Icon && iconPosition === 'left' ? (
          <Icon
            className="shrink-0"
            size={size === 'xs' ? 12 : size === 'sm' ? 14 : 16}
            aria-hidden="true"
          />
        ) : null}
        {children}
        {!loading && Icon && iconPosition === 'right' ? (
          <Icon
            className="shrink-0"
            size={size === 'xs' ? 12 : size === 'sm' ? 14 : 16}
            aria-hidden="true"
          />
        ) : null}
      </button>
    );
  },
);

Button.displayName = 'Button';
