import { Coffee } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KOFI_BUTTON_LABEL, openKofi } from "@/lib/supportLinks";

type Props = {
  variant?: "default" | "secondary" | "ghost";
  size?: "default" | "sm";
  className?: string;
};

export default function SupportCta({
  variant = "secondary",
  size = "default",
  className,
}: Props) {
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={() => void openKofi()}
    >
      <Coffee className="h-4 w-4" />
      {KOFI_BUTTON_LABEL}
    </Button>
  );
}
