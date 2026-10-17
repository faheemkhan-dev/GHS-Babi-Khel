import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { uploadToCloudinary } from "@/lib/cloudinary";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Plus, Trash2, Loader2, Upload, ArrowLeft, Image as ImageIcon, Play, Link2, Film, AlertTriangle, Images } from "lucide-react";
import toast from "react-hot-toast";
import { useDropzone } from "react-dropzone";
import type { GalleryAlbum, GalleryPhoto } from "@/hooks/useGallery";
import { isVideoUrl } from "@/hooks/useGallery";
import { getEmbedInfo, normalizeMediaUrl, youTubeThumbnail } from "@/lib/embedMedia";
import EmbedFrame from "@/components/shared/EmbedFrame";

const AdminGallery = () => {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "" });
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState<GalleryAlbum | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // “Add from Link” — paste a Facebook post/video/reel or YouTube link and it
  // embeds automatically (stored as an ordinary album item, no DB changes).
  // NOTE: the derived values (normalizedLink / linkInfo / linkInvalid /
  // linkDuplicate) and addLinkedMedia live BELOW the photos query — they read
  // `photos`, which must be initialised first or the page crashes the moment a
  // link is pasted ("Cannot access 'photos' before initialization").
  const [linkValue, setLinkValue] = useState("");
  const [addingLink, setAddingLink] = useState(false);

  const { data: albums = [], isLoading } = useQuery<GalleryAlbum[]>({
    queryKey: ["admin-albums"],
    queryFn: async () => {
      const { data, error } = await supabase.from("gallery_albums").select("id, title, description, cover_url, created_at").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const { data: photos = [], isLoading: loadingPhotos } = useQuery<GalleryPhoto[]>({
    queryKey: ["admin-photos", selectedAlbum?.id],
    queryFn: async () => {
      if (!selectedAlbum) return [];
      const { data, error } = await supabase.from("gallery_photos").select("id, album_id, photo_url, caption, media_type, created_at").eq("album_id", selectedAlbum.id).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((p) => ({
        ...p,
        media_type: p.media_type || (isVideoUrl(p.photo_url) ? "video" : "image"),
      })) as GalleryPhoto[];
    },
    enabled: !!selectedAlbum,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  // ── Add-from-link derived values (AFTER `photos` is declared) ──────────
  const normalizedLink = normalizeMediaUrl(linkValue);
  const linkInfo = linkValue.trim() ? getEmbedInfo(normalizedLink) : null;
  const linkInvalid = !!linkValue.trim() && !linkInfo;
  const linkDuplicate = !!linkInfo && photos.some((p) => p.photo_url === normalizedLink);

  const addLinkedMedia = async () => {
    if (!selectedAlbum || !linkInfo) return;
    setAddingLink(true);
    try {
      const { error } = await supabase.from("gallery_photos").insert({
        album_id: selectedAlbum.id,
        photo_url: normalizedLink,
        media_type: "video",
      });
      if (error) {
        toast.error("Failed to embed: " + error.message);
      } else {
        toast.success(linkInfo.label + " embedded in album!");
        setLinkValue("");
        qc.invalidateQueries({ queryKey: ["admin-photos", selectedAlbum.id] });
      }
    } finally {
      setAddingLink(false);
    }
  };

  const handleCreateAlbum = async () => {
    if (!form.title) { toast.error("Title required"); return; }
    setSaving(true);
    try {
      let cover_url: string | null = null;
      if (coverFile) {
        cover_url = await uploadToCloudinary(coverFile, "gallery");
      }
      const { error } = await supabase.from("gallery_albums").insert({ title: form.title, description: form.description || null, cover_url });
      if (error) toast.error("Failed to create album: " + error.message);
      else { toast.success("Album created!"); qc.invalidateQueries({ queryKey: ["admin-albums"] }); setModalOpen(false); }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed. Check Cloudinary env vars.");
    }
    setSaving(false);
  };

  const deleteAlbum = useMutation({
    mutationFn: async (id: string) => {
      // Note: Cloudinary files are not deleted here — manage via Cloudinary dashboard if needed
      await supabase.from("gallery_photos").delete().eq("album_id", id);
      const { error } = await supabase.from("gallery_albums").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Album deleted"); setSelectedAlbum(null); qc.invalidateQueries({ queryKey: ["admin-albums"] }); },
  });

  const onDropFiles = useCallback(async (acceptedFiles: File[]) => {
    if (!selectedAlbum || !acceptedFiles.length) return;
    setUploading(true);
    setUploadProgress(0);
    let uploaded = 0;
    for (const file of acceptedFiles) {
      const isVideo = file.type.startsWith("video/");
      const cloudFolder = isVideo ? "gallery" : "gallery";
      try {
        const url = await uploadToCloudinary(file, cloudFolder);
        const media_type = isVideo ? "video" : "image";
        await supabase.from("gallery_photos").insert({ album_id: selectedAlbum.id, photo_url: url, media_type });
      } catch {
        // skip failed file, continue with others
      }
      uploaded++;
      setUploadProgress(Math.round((uploaded / acceptedFiles.length) * 100));
    }
    toast.success(`${uploaded} files uploaded!`);
    qc.invalidateQueries({ queryKey: ["admin-photos", selectedAlbum.id] });
    setUploading(false);
    setUploadProgress(0);
  }, [selectedAlbum, qc]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onDropFiles,
    accept: { "image/*": [], "video/*": [] },
    multiple: true,
    disabled: uploading,
  });

  const deletePhoto = useMutation({
    mutationFn: async (photo: GalleryPhoto) => {
      // Note: Cloudinary file not deleted here — manage via Cloudinary dashboard if needed
      const { error } = await supabase.from("gallery_photos").delete().eq("id", photo.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("File deleted"); qc.invalidateQueries({ queryKey: ["admin-photos", selectedAlbum?.id] }); },
  });

  // Album detail view
  if (selectedAlbum) {
    return (
      <div className="space-y-4 pb-20 md:pb-0">
        <div className="flex items-center gap-2.5">
          <Button variant="outline" size="icon" onClick={() => setSelectedAlbum(null)} className="h-8 w-8 rounded-full shadow-none shrink-0" aria-label="Back to albums"><ArrowLeft className="w-4 h-4" /></Button>
          <div className="min-w-0">
            <h2 className="text-lg sm:text-2xl font-heading font-bold text-foreground leading-snug break-words">{selectedAlbum.title}</h2>
            <p className="text-[11px] text-muted-foreground">{photos.length} item{photos.length === 1 ? "" : "s"}</p>
          </div>
        </div>

        {/* Upload zone */}
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-2xl p-6 sm:p-8 text-center cursor-pointer transition-colors bg-card ${
            isDragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
          }`}
        >
          <input {...getInputProps()} />
          <div className="w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-2.5"><Upload className="w-5 h-5" /></div>
          <p className="text-sm font-medium text-foreground">Tap to upload photos or videos</p>
          <p className="text-xs text-muted-foreground mt-1">or drag & drop here · images and videos supported</p>
        </div>

        {uploading && (
          <div className="space-y-1">
            <Progress value={uploadProgress} className="h-2" />
            <p className="text-xs text-muted-foreground text-center">{uploadProgress}% uploaded</p>
          </div>
        )}

        {/* Add Facebook / YouTube link — auto-embed with live preview */}
        <div className="rounded-2xl border border-border/60 bg-card p-4 sm:p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl gradient-accent flex items-center justify-center shrink-0">
              <Link2 className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <p className="font-heading font-semibold text-foreground text-sm">Add Facebook or YouTube link</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Paste a Facebook post, video, reel, watch or YouTube link — it embeds automatically with its real thumbnail and plays right inside the gallery.
              </p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 mt-3">
            <div className="relative flex-1">
              <Link2 className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                value={linkValue}
                onChange={(e) => setLinkValue(e.target.value)}
                placeholder="https://www.facebook.com/… post, video, reel or YouTube link"
                className="h-10 rounded-full border-border/60 bg-card pl-10 text-sm shadow-none"
              />
            </div>
            <Button onClick={addLinkedMedia} disabled={!linkInfo || linkDuplicate || addingLink} className="h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-none hover:bg-primary/90 sm:px-5">
              {addingLink ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              {addingLink ? "Embedding…" : "Embed"}
            </Button>
          </div>
          {linkInvalid && (
            <p className="text-xs text-destructive mt-2 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
              Only Facebook posts / videos / reels / watch links and YouTube links can be embedded. For direct photo or video files, use the upload zone above.
            </p>
          )}
          {linkInfo && (
            <div className="mt-3 rounded-lg bg-secondary/40 border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-primary text-primary-foreground gap-1">
                  <Film className="w-3 h-3" />{linkInfo.label}
                </Badge>
                <span className="text-xs text-muted-foreground">detected — will embed automatically</span>
                {linkDuplicate && <Badge className="bg-amber-500/90 text-white">Already in this album</Badge>}
              </div>
              <div
                className="mt-2.5 w-full max-w-[300px] rounded-lg overflow-hidden border border-border bg-black relative"
                style={{ aspectRatio: String(linkInfo.aspect) }}
              >
                <EmbedFrame url={normalizedLink} interactive showReason title="Embed preview" className="absolute inset-0 w-full h-full" />
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">Live preview — exactly how it will appear in the gallery. Click “Embed” to add it.</p>
              {linkInfo.provider === "facebook" && (
                <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                  Share links (/share/…) are converted to Facebook's direct link automatically. If the preview still says “Video Unavailable”, the post is not <span className="font-semibold">Public</span> on Facebook — open it on Facebook, set its audience to Public (private or friends-only videos cannot be embedded by Facebook on any website), then paste the link again.
                </p>
              )}
            </div>
          )}
        </div>

        {loadingPhotos ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[...Array(8)].map((_, i) => <Skeleton key={i} className="aspect-square rounded-xl" />)}</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {photos.map(p => {
              const embed = getEmbedInfo(p.photo_url);
              const ytThumb = embed?.provider === "youtube" ? youTubeThumbnail(p.photo_url) : null;
              const isVideo = !embed && (p.media_type === "video" || isVideoUrl(p.photo_url));
              return (
                <div key={p.id} className="relative group rounded-2xl overflow-hidden aspect-square bg-muted border border-border shadow-sm">
                  {embed ? (
                    ytThumb ? (
                      <>
                        <img src={ytThumb} alt={p.caption || embed.label} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="w-10 h-10 rounded-full bg-black/50 border border-white/30 flex items-center justify-center">
                            <Play className="w-5 h-5 text-white ml-0.5" />
                          </div>
                        </div>
                      </>
                    ) : (
                      <EmbedFrame url={p.photo_url} title={embed.label} className="absolute inset-0 w-full h-full" />
                    )
                  ) : isVideo ? (
                    <>
                      <video src={p.photo_url} preload="metadata" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 flex items-center justify-center bg-foreground/10 pointer-events-none">
                        <div className="w-10 h-10 rounded-full bg-black/50 border border-white/30 flex items-center justify-center">
                          <Play className="w-5 h-5 text-white ml-0.5" />
                        </div>
                      </div>
                    </>
                  ) : (
                    <img src={p.photo_url} alt={p.caption || ""} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                  )}
                  {(isVideo || embed) && (
                    <div className="absolute top-2 left-2 z-10">
                      <Badge className="bg-foreground/70 text-white text-[10px] gap-1"><Play className="w-3 h-3" />{embed ? embed.badge : "VIDEO"}</Badge>
                    </div>
                  )}
                  <div className="absolute top-2 right-2 z-10">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button className="w-7 h-7 rounded-full bg-black/55 hover:bg-destructive text-white flex items-center justify-center backdrop-blur-sm transition-colors" aria-label="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="rounded-2xl">
                        <AlertDialogHeader><AlertDialogTitle>Delete this file?</AlertDialogTitle><AlertDialogDescription>This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
                        <AlertDialogFooter><AlertDialogCancel className="h-9 flex-1 rounded-full px-4 text-xs font-semibold shadow-none sm:flex-none">Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deletePhoto.mutate(p)} className="h-9 flex-1 rounded-full bg-destructive px-4 text-xs font-semibold text-destructive-foreground shadow-none hover:bg-destructive/90 sm:flex-none">Delete</AlertDialogAction></AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Albums list
  return (
    <div className="space-y-4 pb-20 md:pb-0">
      {/* ── Premium header + action toolbar ────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm sm:p-4">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/10 blur-2xl" />
        <div aria-hidden className="pointer-events-none absolute -left-12 -bottom-12 h-28 w-28 rounded-full bg-[hsl(43_89%_58%)]/10 blur-2xl" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-md shadow-primary/20">
            <Images className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-heading font-bold leading-tight tracking-tight text-foreground sm:text-xl">Manage Gallery</h2>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground sm:text-sm">
              <span className="font-semibold text-foreground">{albums.length}</span> album{albums.length === 1 ? "" : "s"} · tap an album to add photos &amp; videos
            </p>
          </div>
        </div>
        <div className="relative mt-3 grid grid-cols-2 gap-2 border-t border-border/60 pt-3 sm:flex sm:flex-wrap">
          <Button onClick={() => { setForm({ title: "", description: "" }); setCoverFile(null); setModalOpen(true); }} className="col-span-2 h-9 min-w-0 gap-1.5 whitespace-nowrap rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-none hover:bg-primary/90 sm:col-span-1">
            <Plus className="h-3.5 w-3.5 shrink-0" /> Create Album
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {albums.length === 0 && <div className="col-span-full rounded-2xl border border-dashed border-border/60 bg-card py-12 text-center text-sm text-muted-foreground">No albums yet</div>}
          {albums.map(a => (
            <Card key={a.id} className="overflow-hidden cursor-pointer rounded-2xl shadow-sm hover:shadow-elevated transition-shadow border-border/60" onClick={() => setSelectedAlbum(a)}>
              <div className="aspect-video bg-muted relative">
                {a.cover_url
                  ? <img src={a.cover_url} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                  : <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-10 h-10 text-muted-foreground/30" /></div>}
              </div>
              <CardContent className="p-3.5">
                <h3 className="font-heading font-semibold text-sm text-foreground leading-snug break-words">{a.title}</h3>
                {a.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{a.description}</p>}
                <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-border/70">
                  <span className="text-[11px] text-primary font-medium">Open album →</span>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full shadow-none text-muted-foreground hover:text-destructive" onClick={e => e.stopPropagation()}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="rounded-2xl">
                      <AlertDialogHeader><AlertDialogTitle>Delete album and all photos?</AlertDialogTitle><AlertDialogDescription>This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
                      <AlertDialogFooter><AlertDialogCancel className="h-9 flex-1 rounded-full px-4 text-xs font-semibold shadow-none sm:flex-none">Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteAlbum.mutate(a.id)} className="h-9 flex-1 rounded-full bg-destructive px-4 text-xs font-semibold text-destructive-foreground shadow-none hover:bg-destructive/90 sm:flex-none">Delete</AlertDialogAction></AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Album Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md rounded-2xl p-5 gap-3">
          <DialogHeader><DialogTitle className="text-base">Create Album</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label className="text-xs">Title *</Label><Input className="h-9 text-sm" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} /></div>
            <div><Label className="text-xs">Description</Label><Textarea rows={3} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} /></div>
            <div>
              <Label className="text-xs">Cover Photo</Label>
              <div className="flex items-center gap-3 mt-1">
                {coverFile && <img src={URL.createObjectURL(coverFile)} alt="" className="w-16 h-10 rounded object-cover" />}
                <label className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border border-border/60 bg-card px-3 text-xs font-semibold text-foreground shadow-none cursor-pointer transition-colors hover:bg-secondary/60">
                  <Upload className="w-3.5 h-3.5" /> Choose Cover
                  <input type="file" accept="image/*" className="hidden" onChange={e => setCoverFile(e.target.files?.[0] || null)} />
                </label>
              </div>
            </div>
          </div>
          <DialogFooter className="flex-row gap-2 sm:justify-end">
            <Button variant="outline" className="h-9 min-w-0 flex-1 whitespace-nowrap rounded-full border-border/60 px-4 text-xs font-semibold shadow-none sm:flex-none" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateAlbum} disabled={saving} className="h-9 min-w-0 flex-1 gap-1.5 whitespace-nowrap rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-none hover:bg-primary/90 sm:flex-none">{saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminGallery;

        
