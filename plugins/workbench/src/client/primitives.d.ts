/**
 * Shared UI components from DSH's Web shell. At run time the shell supplies the
 * module (it is in the platform module table); these declarations cover only
 * what this plugin uses.
 */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ButtonHTMLAttributes, ComponentType, ForwardRefExoticComponent, InputHTMLAttributes, ReactNode, RefAttributes } from 'react'

  export const Button: ForwardRefExoticComponent<
    {
      variant?: 'primary' | 'ghost' | 'outline' | 'toolbar'
      size?: 'md' | 'sm'
      icon?: ReactNode
      className?: string
      children?: ReactNode
    } & ButtonHTMLAttributes<HTMLButtonElement> &
      RefAttributes<HTMLButtonElement>
  >
  export const Input: ForwardRefExoticComponent<
    { icon?: ReactNode; className?: string } & InputHTMLAttributes<HTMLInputElement> & RefAttributes<HTMLInputElement>
  >
  export const IconFolderOpenRegular: ComponentType<{ className?: string }>
  export const IconBranchOutlineRegular: ComponentType<{ className?: string }>
}
