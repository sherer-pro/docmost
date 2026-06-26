import React from "react";
import { Avatar } from "@mantine/core";
import { getAvatarUrl } from "@/lib/config.ts";
import { AvatarIconType } from "@/features/attachments/types/attachment.types.ts";
import { getInitialsColor } from "@/lib/get-initials-color.ts";

interface CustomAvatarProps {
  avatarUrl: string;
  name: string;
  color?: string;
  size?: string | number;
  radius?: string | number;
  variant?: string;
  style?: any;
  component?: any;
  type?: AvatarIconType;
  mt?: string | number;
}

export const CustomAvatar = React.forwardRef<
  HTMLInputElement,
  CustomAvatarProps
>(({ avatarUrl, name, type, color, ...props }: CustomAvatarProps, ref) => {
  const avatarLink = getAvatarUrl(avatarUrl, type);
  const avatarName = name || "";

  return (
    <Avatar
      ref={ref}
      src={avatarLink}
      name={avatarName}
      alt={avatarName}
      color={color ?? getInitialsColor(avatarName)}
      {...props}
    />
  );
});
