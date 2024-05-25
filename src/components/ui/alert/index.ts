import { type VariantProps, cva } from 'class-variance-authority';

export { default as Alert } from './Alert.vue';
export { default as AlertTitle } from './AlertTitle.vue';
export { default as AlertDescription } from './AlertDescription.vue';

export const alertVariants = cva(
	'relative w-full rounded-lg border p-4 [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground',
	{
		variants: {
			variant: {
				default: 'bg-background text-foreground',
				destructive: 'border-destructive/50 bg-destructive text-white font-bold dark:border-destructive [&>svg]:text-destructive',
				info: 'border-info info',
			},
		},
		defaultVariants: {
			variant: 'default',
		},
	}
);

export type AlertVariants = VariantProps<typeof alertVariants>;