import { put }
from "@vercel/blob";

console.log(
  "blob token",
  !!process.env.BLOB_READ_WRITE_TOKEN
);

export async function POST(
  request: Request
) {
  const formData =
    await request.formData();

  const file =
    formData.get(
      "file"
    ) as File;

  if (!file) {
    return Response.json(
      {
        error:
          "No file",
      },
      {
        status: 400,
      }
    );
  }

  const blob =
    await put(
      file.name,
      file,
      {
        access:
          "public",
        addRandomSuffix:
          true,
      }
    );

  return Response.json({
    url: blob.url,
  });
}