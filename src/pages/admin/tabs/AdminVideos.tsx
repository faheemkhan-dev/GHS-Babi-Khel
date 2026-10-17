// AdminVideos.tsx
//
// FIXED (per request): this used to be "Videos & Gallery" with two tabs —
// Videos and Gallery. Video management has been MOVED into AdminLibrary.tsx
// as a "Videos" sub-tab alongside "Files", so admins upload/manage both
// documents and videos from one merged Library section instead of two
// separate admin pages. This file is now Gallery-only (photo albums).
import { lazy, Suspense } from "react";

const AdminGallery = lazy(() => import("./AdminGallery"));

const AdminVideos = () => {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-heading font-bold text-foreground">Gallery</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Manage photo albums & media content</p>
      </div>
      <Suspense fallback={<div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />)}</div>}>
        <AdminGallery />
      </Suspense>
    </div>
  );
};

export default AdminVideos;
