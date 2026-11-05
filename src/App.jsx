
import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import "./App.css";

const BUCKET = "pg-photos";
const MAX_FILES = 5;
const MAX_SIZE = 5 * 1024 * 1024;

export default function App() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authRole, setAuthRole] = useState("seeker");
  const [newPassword, setNewPassword] = useState("");

  const [pgs, setPgs] = useState([]);
  const [selectedPGId, setSelectedPGId] = useState(null);

  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [price, setPrice] = useState("");
  const [type, setType] = useState("Boys");
  const [phone, setPhone] = useState("");
  const [newPhotos, setNewPhotos] = useState([]);

  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("All");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [uploading, setUploading] = useState(false);

  const selectedPG = pgs.find((pg) => pg.id === selectedPGId);

  function clearMessages() {
    setMessage("");
    setError("");
  }

  async function loadProfile(currentUser) {
    if (!currentUser) {
      setRole("");
      return;
    }

    const { data, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", currentUser.id)
      .maybeSingle();

    if (profileError) {
      setError("Profile loading failed: " + profileError.message);
      setRole("");
      return;
    }

    setRole(data?.role || currentUser.user_metadata?.role || "");
  }

  async function loadPGs() {
    const { data, error: pgError } = await supabase
      .from("pgs")
      .select("*")
      .order("created_at", { ascending: false });

    if (pgError) {
      setError("PG loading failed: " + pgError.message);
      return;
    }

    setPgs(data || []);
  }

  // STEP 2: Password recovery link handling is included here.
  useEffect(() => {
    let mounted = true;

    async function initialize() {
      const recovery =
        window.location.hash.includes("type=recovery");

      if (recovery) {
        setAuthMode("recovery");
      }

      const { data } = await supabase.auth.getSession();

      if (!mounted) return;

      const currentUser = data.session?.user || null;
      setUser(currentUser);

      if (currentUser) {
        await loadProfile(currentUser);
      }

      await loadPGs();

      if (mounted) setLoading(false);
    }

    initialize();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;

      const currentUser = session?.user || null;

      setUser(currentUser);

      if (!currentUser) {
        setRole("");
      } else {
        setTimeout(() => {
          if (mounted) loadProfile(currentUser);
        }, 0);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("pgs-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "pgs",
        },
        () => loadPGs()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function handleSignup(e) {
    e.preventDefault();
    clearMessages();

    if (password.length < 6) {
      setError("Password must contain at least 6 characters.");
      return;
    }

    const { data, error: signupError } =
      await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { role: authRole },
        },
      });

    if (signupError) {
      setError(signupError.message);
      return;
    }

    if (data.session) {
      setUser(data.user);
      await loadProfile(data.user);
      setMessage("Registration successful.");
    } else {
      setMessage("Signup successful. Verify your email, then login.");
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    clearMessages();

    const { data, error: loginError } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });

    if (loginError) {
      setError(loginError.message);
      return;
    }

    setUser(data.user);
    await loadProfile(data.user);
    setMessage("Login successful.");
  }

  async function handleLogout() {
    clearMessages();

    const { error: logoutError } =
      await supabase.auth.signOut();

    if (logoutError) {
      setError(logoutError.message);
      return;
    }

    setUser(null);
    setRole("");
    setSelectedPGId(null);
    setMessage("Logged out successfully.");
  }

  async function handleForgotPassword(e) {
    e.preventDefault();
    clearMessages();

    const { error: resetError } =
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });

    if (resetError) {
      setError(resetError.message);
      return;
    }

    setMessage("Password reset email sent. Check your inbox.");
  }

  async function handlePasswordUpdate(e) {
    e.preventDefault();
    clearMessages();

    if (newPassword.length < 6) {
      setError("Password must contain at least 6 characters.");
      return;
    }

    const { error: updateError } =
      await supabase.auth.updateUser({
        password: newPassword,
      });

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setNewPassword("");
    setAuthMode("login");
    setMessage("Password changed successfully.");
  }

  function validatePhotos(files) {
    if (files.length > MAX_FILES) {
      return "Select a maximum of 5 photos.";
    }

    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        return "Only image files are allowed.";
      }

      if (file.size > MAX_SIZE) {
        return "Each photo must be 5 MB or smaller.";
      }
    }

    return "";
  }

  async function uploadPhotos(pg, files) {
    clearMessages();

    if (!user || role !== "owner") {
      setError("Only owners can upload photos.");
      return false;
    }

    if (pg.owner_id !== user.id) {
      setError(
        "This PG does not belong to your Owner account. Check owner_id in Supabase."
      );
      return false;
    }

    if (!files.length) {
      setError("Please select photos first.");
      return false;
    }

    const validationError = validatePhotos(files);

    if (validationError) {
      setError(validationError);
      return false;
    }

    setUploading(true);

    const uploadedPaths = [];
    const uploadedUrls = [];

    try {
      for (const file of files) {
        const safeName = file.name.replace(
          /[^a-zA-Z0-9._-]/g,
          "_"
        );

        const path =
          `${user.id}/${pg.id}/${Date.now()}-${safeName}`;

        const { error: storageError } =
          await supabase.storage
            .from(BUCKET)
            .upload(path, file, {
              cacheControl: "3600",
              upsert: false,
              contentType: file.type,
            });

        if (storageError) throw storageError;

        uploadedPaths.push(path);

        const { data: publicData } =
          supabase.storage
            .from(BUCKET)
            .getPublicUrl(path);

        if (!publicData?.publicUrl) {
          throw new Error("Could not generate photo URL.");
        }

        uploadedUrls.push(publicData.publicUrl);
      }

      const existingUrls = Array.isArray(pg.photo_urls)
        ? pg.photo_urls
        : [];

      const updatedUrls = [
        ...existingUrls,
        ...uploadedUrls,
      ];

      const { data: updatedPG, error: updateError } =
        await supabase
          .from("pgs")
          .update({ photo_urls: updatedUrls })
          .eq("id", pg.id)
          .eq("owner_id", user.id)
          .select()
          .single();

      if (updateError) throw updateError;

      if (!updatedPG) {
        throw new Error("Database did not confirm the update.");
      }

      setPgs((previous) =>
        previous.map((item) =>
          item.id === updatedPG.id ? updatedPG : item
        )
      );

      setMessage("PG photos uploaded and saved successfully!");
      return true;

    } catch (uploadError) {
      if (uploadedPaths.length > 0) {
        await supabase.storage
          .from(BUCKET)
          .remove(uploadedPaths);
      }

      setError("Photo upload failed: " + uploadError.message);
      return false;

    } finally {
      setUploading(false);
    }
  }

  async function handleAddPG(e) {
    e.preventDefault();
    clearMessages();

    if (!user || role !== "owner") {
      setError("Only owners can register PGs.");
      return;
    }

    if (!name || !area || !price || !phone) {
      setError("Fill all PG details.");
      return;
    }

    const rent = Number(price);

    if (!Number.isFinite(rent) || rent <= 0) {
      setError("Enter a valid monthly rent.");
      return;
    }

    const { data, error: insertError } =
      await supabase
        .from("pgs")
        .insert([{
          name,
          area,
          price: rent,
          type,
          phone,
          owner_id: user.id,
          photo_urls: [],
        }])
        .select()
        .single();

    if (insertError) {
      setError("PG registration failed: " + insertError.message);
      return;
    }

    setName("");
    setArea("");
    setPrice("");
    setPhone("");

    const files = [...newPhotos];
    setNewPhotos([]);

    await loadPGs();
    setSelectedPGId(data.id);

    if (files.length) {
      await uploadPhotos(data, files);
    } else {
      setMessage("PG registered successfully!");
    }
  }

  async function handleDeletePG(pg) {
    clearMessages();

    if (
      !user ||
      role !== "owner" ||
      pg.owner_id !== user.id
    ) {
      setError("You cannot delete this PG.");
      return;
    }

    if (!window.confirm(`Delete ${pg.name}?`)) return;

    const { error: deleteError } = await supabase
      .from("pgs")
      .delete()
      .eq("id", pg.id)
      .eq("owner_id", user.id);

    if (deleteError) {
      setError("Delete failed: " + deleteError.message);
      return;
    }

    setSelectedPGId(null);
    await loadPGs();
    setMessage("PG deleted successfully.");
  }

  const filteredPGs = useMemo(() => {
    return pgs.filter((pg) => {
      const text = `${pg.name} ${pg.area}`.toLowerCase();
      const matchesSearch = text.includes(search.toLowerCase());

      const matchesType =
        filterType === "All" || pg.type === filterType;

      const rent = Number(pg.price);

      const matchesMin =
        minPrice === "" || rent >= Number(minPrice);

      const matchesMax =
        maxPrice === "" || rent <= Number(maxPrice);

      return (
        matchesSearch &&
        matchesType &&
        matchesMin &&
        matchesMax
      );
    });
  }, [pgs, search, filterType, minPrice, maxPrice]);

  if (loading) {
    return <main className="container"><h2>Loading...</h2></main>;
  }

  const isOwner = user && role === "owner";

  const ownsSelectedPG =
    selectedPG &&
    user &&
    selectedPG.owner_id === user.id;

  return (
    <main className="container">

      <header className="header">
        <div>
          <h1>Hyderabad PG Finder</h1>
          <p>Find and register PG accommodation in Hyderabad.</p>
        </div>

        {user && (
          <div className="account">
            <span>{user.email} ({role || "loading"})</span>
            <button onClick={handleLogout}>Logout</button>
          </div>
        )}
      </header>

      {message && <div className="success">{message}</div>}
      {error && <div className="error">{error}</div>}

      {!user && (
        <section className="card">
          <h2>
            {authMode === "signup"
              ? "Create Account"
              : authMode === "forgot"
              ? "Forgot Password"
              : authMode === "recovery"
              ? "Set New Password"
              : "Login"}
          </h2>

          {authMode === "recovery" ? (
            <form onSubmit={handlePasswordUpdate}>
              <label>New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                required
              />
              <button type="submit">Update Password</button>
            </form>
          ) : (
            <form
              onSubmit={
                authMode === "signup"
                  ? handleSignup
                  : authMode === "forgot"
                  ? handleForgotPassword
                  : handleLogin
              }
            >
              <label>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />

              {authMode !== "forgot" && (
                <>
                  <label>Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </>
              )}

              {authMode === "signup" && (
                <>
                  <label>Account Type</label>
                  <select
                    value={authRole}
                    onChange={(e) => setAuthRole(e.target.value)}
                  >
                    <option value="seeker">PG Seeker</option>
                    <option value="owner">PG Owner</option>
                  </select>
                </>
              )}

              <button type="submit">
                {authMode === "signup"
                  ? "Sign Up"
                  : authMode === "forgot"
                  ? "Send Reset Email"
                  : "Login"}
              </button>
            </form>
          )}

          <div className="auth-links">
            {authMode !== "login" && (
              <button
                className="link-button"
                onClick={() => {
                  clearMessages();
                  setAuthMode("login");
                }}
              >
                Back to Login
              </button>
            )}

            {authMode === "login" && (
              <>
                <button
                  className="link-button"
                  onClick={() => {
                    clearMessages();
                    setAuthMode("signup");
                  }}
                >
                  Create Account
                </button>

                <button
                  className="link-button"
                  onClick={() => {
                    clearMessages();
                    setAuthMode("forgot");
                  }}
                >
                  Forgot Password?
                </button>
              </>
            )}
          </div>
        </section>
      )}

      {user && (
        <>
          {isOwner && !selectedPG && (
            <section className="card">
              <h2>Register Your PG</h2>

              <form onSubmit={handleAddPG}>
                <label>PG Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />

                <label>Area</label>
                <input
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  required
                />

                <label>Monthly Rent (₹)</label>
                <input
                  type="number"
                  min="1"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  required
                />

                <label>PG Type</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                >
                  <option value="Boys">Boys</option>
                  <option value="Girls">Girls</option>
                  <option value="Co-living">Co-living</option>
                </select>

                <label>Owner Contact</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />

                <label>PG Photos (Maximum 5, each up to 5 MB)</label>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    const validation = validatePhotos(files);

                    if (validation) {
                      setError(validation);
                      setNewPhotos([]);
                      e.target.value = "";
                    } else {
                      clearMessages();
                      setNewPhotos(files);
                    }
                  }}
                />

                <button type="submit" disabled={uploading}>
                  Register PG
                </button>
              </form>
            </section>
          )}

          {selectedPG ? (
            <section className="card">
              <button
                className="back-button"
                onClick={() => {
                  clearMessages();
                  setSelectedPGId(null);
                }}
              >
                ← Back to PG Listings
              </button>

              <h2>{selectedPG.name}</h2>

              <h3>PG Information</h3>
              <p><strong>PG Name:</strong> {selectedPG.name}</p>
              <p><strong>Area:</strong> {selectedPG.area}</p>
              <p><strong>Monthly Rent:</strong> ₹{selectedPG.price}</p>
              <p><strong>PG Type:</strong> {selectedPG.type}</p>
              <p><strong>Owner Contact:</strong> {selectedPG.phone}</p>

              <a href={`tel:${selectedPG.phone}`} className="call-button">
                Call Owner
              </a>

              <h3>PG Photos</h3>

              {Array.isArray(selectedPG.photo_urls) &&
              selectedPG.photo_urls.length > 0 ? (
                <div className="photo-grid">
                  {selectedPG.photo_urls.map((url, index) => (
                    <img
                      key={`${url}-${index}`}
                      src={url}
                      alt={`${selectedPG.name} photo ${index + 1}`}
                    />
                  ))}
                </div>
              ) : (
                <p>No photos uploaded yet.</p>
              )}

              {isOwner && (
                <div className="upload-section">
                  <h3>Owner Photo Upload</h3>

                  {ownsSelectedPG ? (
                    <>
                      <label>Select PG Photos</label>

                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(e) => {
                          const files = Array.from(e.target.files || []);
                          const validation = validatePhotos(files);

                          if (validation) {
                            setError(validation);
                            setNewPhotos([]);
                            e.target.value = "";
                          } else {
                            clearMessages();
                            setNewPhotos(files);
                          }
                        }}
                      />

                      <button
                        disabled={uploading || newPhotos.length === 0}
                        onClick={async () => {
                          const success = await uploadPhotos(
                            selectedPG,
                            newPhotos
                          );

                          if (success) setNewPhotos([]);
                        }}
                      >
                        {uploading
                          ? "Uploading..."
                          : "Upload More Photos"}
                      </button>

                      <p>
                        Maximum 5 photos per upload. Each photo must be 5 MB or less.
                      </p>
                    </>
                  ) : (
                    <p className="error">
                      This PG is not assigned to your Owner account.
                      Check owner_id in Supabase.
                    </p>
                  )}

                  {ownsSelectedPG && (
                    <button
                      className="delete-button"
                      onClick={() => handleDeletePG(selectedPG)}
                    >
                      Delete This PG
                    </button>
                  )}
                </div>
              )}
            </section>
          ) : (
            <section>
              <h2>Available PG Listings</h2>

              <div className="card filters">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search PG name or area"
                />

                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                >
                  <option value="All">All PG Types</option>
                  <option value="Boys">Boys</option>
                  <option value="Girls">Girls</option>
                  <option value="Co-living">Co-living</option>
                </select>

                <input
                  type="number"
                  placeholder="Minimum rent"
                  value={minPrice}
                  onChange={(e) => setMinPrice(e.target.value)}
                />

                <input
                  type="number"
                  placeholder="Maximum rent"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                />

                <button
                  onClick={() => {
                    setSearch("");
                    setFilterType("All");
                    setMinPrice("");
                    setMaxPrice("");
                  }}
                >
                  Clear Filters
                </button>
              </div>

              <div className="pg-grid">
                {filteredPGs.map((pg) => (
                  <article className="card pg-card" key={pg.id}>
                    {pg.photo_urls?.[0] && (
                      <img
                        className="listing-photo"
                        src={pg.photo_urls[0]}
                        alt={pg.name}
                      />
                    )}

                    <h3>{pg.name}</h3>
                    <p>Area: {pg.area}</p>
                    <p>Rent: ₹{pg.price}/month</p>
                    <p>Type: {pg.type}</p>

                    <button
                      onClick={() => {
                        clearMessages();
                        setSelectedPGId(pg.id);
                      }}
                    >
                      View Details
                    </button>
                  </article>
                ))}
              </div>

              {filteredPGs.length === 0 && (
                <p>No PG listings found. Try changing your filters.</p>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
