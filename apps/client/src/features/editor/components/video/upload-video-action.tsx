import { handleVideoUpload } from "@docmost/editor-ext";
import { uploadFile } from "@/features/page/services/page-service.ts";
import { notifications } from "@mantine/notifications";

export const uploadVideoAction = handleVideoUpload({
  onUpload: async (file: File, pageId: string): Promise<any> => {
    try {
      return await uploadFile(file, pageId);
    } catch (err) {
      notifications.show({
        color: "red",
        message: err?.response.data.message,
      });
      throw err;
    }
  },
  validateFn: (file) => {
    if (!file.type.includes("video/")) {
      return false;
    }

    if (file.size / 1024 / 1024 > 50) {
      notifications.show({
        color: "red",
        message: `File exceeds the 50 MB attachment limit`,
      });
      return false;
    }
    return true;
  },
});
