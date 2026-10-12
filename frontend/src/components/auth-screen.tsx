import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { makeStyles, useTheme } from "@/src/theme";

export function AuthScreen({
  onSignIn,
  onSignUp,
}: {
  onSignIn: (email: string, password: string) => Promise<void>;
  onSignUp: (
    name: string,
    email: string,
    mobile: string,
    password: string
  ) => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();

  const { width } = useWindowDimensions();
  const isDesktop = width >= 850;

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true);
    setError("");

    try {
      if (mode === "signin") {
        await onSignIn(email.trim(), password);
      } else {
        await onSignUp(
          name.trim(),
          email.trim(),
          mobile.trim(),
          password
        );
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Authentication failed."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAwareScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 30,
        },
      ]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      bottomOffset={16}
    >
      {/* Background glow */}
      <View style={styles.glowTop} />
      <View style={styles.glowBottom} />

      {/* ================= HEADER ================= */}

      <View style={styles.header}>
        <View style={styles.brandSection}>
          <View style={styles.signalMark}>
            <Ionicons
              name="radio-outline"
              size={30}
              color={colors.onBrandPrimary}
            />
          </View>

          <View>
            <Text style={styles.logoText}>
              CRISIS
              <Text style={styles.logoRed}>OS</Text>
            </Text>

            <Text style={styles.logoSub}>
              SECURE ACCESS
            </Text>
          </View>
        </View>

        {/* System status */}
        <View style={styles.systemStatus}>
          

          <Text style={styles.statusText}>
            
          </Text>
        </View>
      </View>

      {/* ================= MAIN ================= */}

      <View
        style={[
          styles.main,
          isDesktop
            ? styles.mainDesktop
            : styles.mainMobile,
        ]}
      >
        {/* ================= HERO ================= */}

        <View
          style={[
            styles.hero,
            isDesktop
              ? styles.heroDesktop
              : styles.heroMobile,
          ]}
        >
          <View style={styles.badge}>
            <View style={styles.badgeDot} />

            <Text style={styles.badgeText}>
              EMERGENCY RESPONSE PLATFORM
            </Text>
          </View>

          <Text style={styles.title}>
            From emergency{"\n"}
            signal to{" "}
            <Text style={styles.titleRed}>
              coordinated
            </Text>{" "}
            response.
          </Text>

          <Text style={styles.body}>
            A human-controlled emergency operations
            platform. AI recommends. Authorized
            operators approve.
          </Text>

          {/* Feature cards */}
          <View
            style={[
              styles.features,
              !isDesktop && styles.featuresMobile,
            ]}
          >
            <Feature
              icon="sparkles-outline"
              title="AI"
              subtitle="Recommendations"
              colors={colors}
            />

            <Feature
              icon="people-outline"
              title="Human"
              subtitle="Authorization"
              colors={colors}
            />

            <Feature
              icon="flash-outline"
              title="Real-time           "
              subtitle="Coordination"
              colors={colors}
            />

            <Feature
              icon="alert-outline"
              title="SOS"
              subtitle="Citizen alert"
              colors={colors}
            />
          </View>

          {/* Radar decoration */}
          <View style={styles.radar}>
            <View style={styles.radarOuter}>
              <View style={styles.radarMiddle}>
                <View style={styles.radarInner}>
                  <Ionicons
                    name="location"
                    size={27}
                    color="#FF3B3B"
                  />
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* ================= AUTH CARD ================= */}

        <View
          style={[
            styles.panel,
            isDesktop
              ? styles.panelDesktop
              : styles.panelMobile,
          ]}
        >
          {/* Card header */}
          <View style={styles.cardHeader}>
            <View style={styles.cardIcon}>
              <Ionicons
                name="radio-outline"
                size={27}
                color="#FF4242"
              />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>
                {mode === "signin"
                  ? "Welcome back"
                  : "Create your account"}
              </Text>

              <Text style={styles.cardSubtitle}>
                {mode === "signin"
                  ? "Sign in to your CrisisOS account"
                  : "Join the CrisisOS emergency network"}
              </Text>
            </View>
          </View>

          {/* ================= MODE ================= */}

          <View style={styles.modeRow}>
            <Pressable
              testID="auth-mode-signin"
              onPress={() => {
                setMode("signin");
                setError("");
              }}
              style={[
                styles.modeButton,
                mode === "signin" &&
                  styles.modeActive,
              ]}
            >
              <Ionicons
                name="log-in-outline"
                size={17}
                color={
                  mode === "signin"
                    ? "#FFFFFF"
                    : "#7F8996"
                }
              />

              <Text
                style={[
                  styles.modeText,
                  mode === "signin" &&
                    styles.modeTextActive,
                ]}
              >
                SIGN IN
              </Text>
            </Pressable>

            <Pressable
              testID="auth-mode-signup"
              onPress={() => {
                setMode("signup");
                setError("");
              }}
              style={[
                styles.modeButton,
                mode === "signup" &&
                  styles.modeActive,
              ]}
            >
              <Ionicons
                name="person-add-outline"
                size={17}
                color={
                  mode === "signup"
                    ? "#FFFFFF"
                    : "#7F8996"
                }
              />

              <Text
                style={[
                  styles.modeText,
                  mode === "signup" &&
                    styles.modeTextActive,
                ]}
              >
                CREATE ACCOUNT
              </Text>
            </Pressable>
          </View>

          {/* ================= SIGNUP NAME ================= */}

          {mode === "signup" ? (
            <View style={styles.field}>
              <Text style={styles.label}>
                FULL NAME
              </Text>

              <View style={styles.inputWrapper}>
                <Ionicons
                  name="person-outline"
                  size={19}
                  color="#7F8996"
                />

                <TextInput
                  testID="auth-name-input"
                  value={name}
                  onChangeText={setName}
                  placeholder="Enter your full name"
                  placeholderTextColor="#687380"
                  autoCapitalize="words"
                  style={styles.input}
                />
              </View>
            </View>
          ) : null}

          {/* ================= SIGNUP MOBILE ================= */}

          {mode === "signup" ? (
            <View style={styles.field}>
              <Text style={styles.label}>
                MOBILE NUMBER
              </Text>

              <View style={styles.inputWrapper}>
                <Ionicons
                  name="call-outline"
                  size={19}
                  color="#7F8996"
                />

                <TextInput
                  testID="auth-mobile-input"
                  value={mobile}
                  onChangeText={setMobile}
                  placeholder="Enter mobile number (e.g., +15551234567)"
                  placeholderTextColor="#687380"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="phone-pad"
                  style={styles.input}
                />
              </View>
            </View>
          ) : null}

          {/* ================= EMAIL ================= */}

          <View style={styles.field}>
            <Text style={styles.label}>
              EMAIL ADDRESS
            </Text>

            <View style={styles.inputWrapper}>
              <Ionicons
                name="mail-outline"
                size={19}
                color="#7F8996"
              />

              <TextInput
                testID="auth-email-input"
                value={email}
                onChangeText={setEmail}
                placeholder="Enter your email"
                placeholderTextColor="#687380"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                style={styles.input}
              />
            </View>
          </View>

          {/* ================= PASSWORD ================= */}

          <View style={styles.field}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>
                PASSWORD
              </Text>

              {mode === "signin" ? (
                <Pressable
                  onPress={() =>
                    setError(
                      "Password recovery can be added here."
                    )
                  }
                >
                  <Text style={styles.forgotText}>
                    Forgot password?
                  </Text>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.inputWrapper}>
              <Ionicons
                name="lock-closed-outline"
                size={19}
                color="#7F8996"
              />

              <TextInput
                testID="auth-password-input"
                value={password}
                onChangeText={setPassword}
                placeholder={
                  mode === "signup"
                    ? "Password (min 12 characters)"
                    : "Enter your password"
                }
                placeholderTextColor="#687380"
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                style={styles.input}
              />

              <Pressable
                onPress={() =>
                  setShowPassword(!showPassword)
                }
                hitSlop={10}
              >
                <Ionicons
                  name={
                    showPassword
                      ? "eye-outline"
                      : "eye-off-outline"
                  }
                  size={20}
                  color="#7F8996"
                />
              </Pressable>
            </View>
          </View>

          {/* ================= ERROR ================= */}

          {error ? (
            <View style={styles.errorRow}>
              <Ionicons
                name="alert-circle-outline"
                size={17}
                color={colors.error}
              />

              <Text style={styles.errorText}>
                {error}
              </Text>
            </View>
          ) : null}

          {/* ================= SUBMIT ================= */}

          <Pressable
            testID="auth-submit-button"
            onPress={submit}
            disabled={busy}
            style={({ pressed }) => [
              styles.submit,
              pressed && styles.pressed,
              busy && styles.disabled,
            ]}
          >
            {busy ? (
              <ActivityIndicator
                color="#FFFFFF"
              />
            ) : (
              <>
                <Text style={styles.submitText}>
                  {mode === "signin"
                    ? "SIGN IN"
                    : "CREATE ACCOUNT"}
                </Text>

                <Ionicons
                  name="arrow-forward"
                  size={19}
                  color="#FFFFFF"
                />
              </>
            )}
          </Pressable>

          {/* ================= DIVIDER ================= */}

          <View style={styles.dividerRow}>
            <View style={styles.divider} />

            <Text style={styles.orText}>
              OR
            </Text>

            <View style={styles.divider} />
          </View>

          {/* ================= SWITCH ACCOUNT ================= */}

          <Pressable
            onPress={() => {
              setMode(
                mode === "signin"
                  ? "signup"
                  : "signin"
              );
              setError("");
            }}
            style={styles.secondaryButton}
          >
            <Ionicons
              name={
                mode === "signin"
                  ? "person-add-outline"
                  : "log-in-outline"
              }
              size={19}
              color="#FFFFFF"
            />

            <Text style={styles.secondaryText}>
              {mode === "signin"
                ? "CREATE ACCOUNT"
                : "BACK TO SIGN IN"}
            </Text>
          </Pressable>

          {/* ================= SIGNUP INFO ================= */}

          {mode === "signup" ? (
            <View style={styles.infoBox}>
              <Ionicons
                name="information-circle-outline"
                size={17}
                color="#8A95A3"
              />

              <Text style={styles.hint}>
                Self-registered accounts are Citizen
                accounts. Responder and operator roles
                are provisioned by administrators.
              </Text>
            </View>
          ) : null}

          {/* ================= SECURITY ================= */}

          <View style={styles.security}>
            <Ionicons
              name="shield-checkmark-outline"
              size={17}
              color="#687380"
            />

            <Text style={styles.securityText}>
              Secure connection • Human approved
              dispatch
            </Text>
          </View>
        </View>
      </View>

      {/* ================= FOOTER ================= */}

      <Text style={styles.safetyNote}>
        CRISISOS • AI ASSISTED • HUMAN APPROVED
        DISPATCH ONLY
      </Text>
    </KeyboardAwareScrollView>
  );
}


/* ========================================================= */
/* FEATURE COMPONENT                                          */
/* ========================================================= */

function Feature({
  icon,
  title,
  subtitle,
  colors,
}: {
  icon: any;
  title: string;
  subtitle: string;
  colors: any;
}) {
  return (
    <View style={stylesFeature.feature}>
      <View style={stylesFeature.icon}>
        <Ionicons
          name={icon}
          size={23}
          color="#FF4B4B"
        />
      </View>

      <View>
        <Text style={stylesFeature.title}>
          {title}
        </Text>

        <Text style={stylesFeature.subtitle}>
          {subtitle}
        </Text>
      </View>
    </View>
  );
}


/* ========================================================= */
/* MAIN STYLES                                                */
/* ========================================================= */

const useStyles = makeStyles((colors) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: "#270a0a",
    },

    content: {
      paddingHorizontal: 24,
      position: "relative",
      overflow: "hidden",
    },

    /* ---------- BACKGROUND ---------- */

    glowTop: {
      position: "absolute",
      width: 420,
      height: 420,
      borderRadius: 210,
      backgroundColor: "hsla(0, 25%, 88%, 0.06)",
      top: -200,
      right: -130,
    },

    glowBottom: {
      position: "absolute",
      width: 360,
      height: 360,
      borderRadius: 180,
      backgroundColor: "rgba(255, 30, 30, 0.04)",
      bottom: -160,
      left: -180,
    },

    /* ---------- HEADER ---------- */

    header: {
      width: "100%",
      maxWidth: 1400,
      alignSelf: "center",
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 55,
    },

    brandSection: {
      flexDirection: "row",
      alignItems: "center",
    },

    signalMark: {
      width: 62,
      height: 62,
      borderRadius: 16,
      backgroundColor: "#F02F2F",
      alignItems: "center",
      justifyContent: "center",
      marginRight: 14,

      shadowColor: "#FF2222",
      shadowOpacity: 0.35,
      shadowRadius: 18,
      elevation: 10,
    },

    logoText: {
      color: "#FFFFFF",
      fontSize: 27,
      fontWeight: "900",
      letterSpacing: 2,
    },

    logoRed: {
      color: "#FF3636",
    },

    logoSub: {
      color: "#707B88",
      fontSize: 9,
      fontWeight: "700",
      letterSpacing: 3.5,
      marginTop: 3,
    },

    systemStatus: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },

    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: "#25D47B",
    },

    statusText: {
      color: "#25D47B",
      fontSize: 11,
      fontWeight: "800",
      letterSpacing: 1,
    },

    /* ---------- MAIN ---------- */

    main: {
      width: "100%",
      maxWidth: 1400,
      alignSelf: "center",
    },

    mainDesktop: {
      flexDirection: "row",
      alignItems: "center",
      gap: 70,
    },

    mainMobile: {
      flexDirection: "column",
    },

    /* ---------- HERO ---------- */

    hero: {
      position: "relative",
    },

    heroDesktop: {
      flex: 1,
      minHeight: 520,
      justifyContent: "center",
    },

    heroMobile: {
      width: "100%",
      marginBottom: 30,
    },

    badge: {
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      borderWidth: 1,
      borderColor: "#6B2528",
      backgroundColor: "hsla(0, 27%, 90%, 0.08)",
      borderRadius: 30,
      paddingHorizontal: 13,
      paddingVertical: 8,
      marginBottom: 22,
    },

    badgeDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: "#FF3D3D",
      marginRight: 8,
    },

    badgeText: {
      color: "#FF4B4B",
      fontSize: 10,
      fontWeight: "900",
      letterSpacing: 1.3,
    },

    title: {
      color: "#FFFFFF",
      fontSize: 46,
      lineHeight: 54,
      fontWeight: "900",
      letterSpacing: -1,
    },

    titleRed: {
      color: "#FF3838",
    },

    body: {
      color: "#ddedff",
      fontSize: 15,
      lineHeight: 24,
      marginTop: 22,
      maxWidth: 600,
    },

    /* ---------- FEATURES ---------- */

    features: {
      flexDirection: "row",
      gap: 28,
      marginTop: 38,
    },

    featuresMobile: {
      flexWrap: "wrap",
      gap: 18,
    },

    /* ---------- RADAR ---------- */

    radar: {
      position: "absolute",
      right: 15,
      top: -30,
    },

    radarOuter: {
      width: 175,
      height: 175,
      borderRadius: 88,
      borderWidth: 1,
      borderColor: "rgba(255, 50, 50, 0.13)",
      justifyContent: "center",
      alignItems: "center",
    },

    radarMiddle: {
      width: 120,
      height: 120,
      borderRadius: 60,
      borderWidth: 1,
      borderColor: "rgba(255, 50, 50, 0.2)",
      justifyContent: "center",
      alignItems: "center",
    },

    radarInner: {
      width: 68,
      height: 68,
      borderRadius: 34,
      backgroundColor: "rgba(255, 40, 40, 0.1)",
      justifyContent: "center",
      alignItems: "center",
    },

    /* ---------- AUTH CARD ---------- */

    panel: {
      backgroundColor: "#0C1118",
      borderWidth: 1,
      borderColor: "#322127",
      borderRadius: 24,
      padding: 28,

      shadowColor: "#000000",
      shadowOpacity: 0.5,
      shadowRadius: 30,
      elevation: 18,
    },

    panelDesktop: {
      width: 470,
    },

    panelMobile: {
      width: "100%",
    },

    /* ---------- CARD HEADER ---------- */

    cardHeader: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 25,
    },

    cardIcon: {
      width: 53,
      height: 53,
      borderRadius: 15,
      backgroundColor: "rgba(255, 50, 50, 0.1)",
      borderWidth: 1,
      borderColor: "#512326",
      alignItems: "center",
      justifyContent: "center",
      marginRight: 15,
    },

    cardTitle: {
      color: "#FFFFFF",
      fontSize: 25,
      fontWeight: "900",
    },

    cardSubtitle: {
      color: "#778391",
      fontSize: 13,
      marginTop: 4,
    },

    /* ---------- MODE ---------- */

    modeRow: {
      flexDirection: "row",
      gap: 8,
      marginBottom: 6,
    },

    modeButton: {
      flex: 1,
      minHeight: 46,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: "#303843",
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 7,
    },

    modeActive: {
      backgroundColor: "#321A1D",
      borderColor: "#E53333",
    },

    modeText: {
      color: "#7C8794",
      fontSize: 10,
      fontWeight: "900",
      letterSpacing: 0.8,
    },

    modeTextActive: {
      color: "#FFFFFF",
    },

    /* ---------- FIELDS ---------- */

    field: {
      marginTop: 16,
    },

    labelRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 8,
    },

    label: {
      color: "#C9D0D8",
      fontSize: 10,
      fontWeight: "900",
      letterSpacing: 1,
      marginBottom: 8,
    },

    inputWrapper: {
      minHeight: 55,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: "#303843",
      backgroundColor: "#10161E",
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 15,
    },

    input: {
      flex: 1,
      color: "#FFFFFF",
      fontSize: 14,
      marginLeft: 11,
      paddingVertical: 0,
    },

    forgotText: {
      color: "#FF4444",
      fontSize: 11,
      fontWeight: "800",
    },

    /* ---------- ERROR ---------- */

    errorRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginTop: 14,
      padding: 11,
      borderRadius: 10,
      backgroundColor: "rgba(255, 50, 50, 0.08)",
      borderWidth: 1,
      borderColor: "rgba(255, 50, 50, 0.18)",
    },

    errorText: {
      color: colors.error,
      fontSize: 12,
      flex: 1,
      lineHeight: 17,
    },

    /* ---------- SUBMIT ---------- */

    submit: {
      minHeight: 56,
      borderRadius: 12,
      backgroundColor: "#EF3030",
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 10,
      marginTop: 23,

      shadowColor: "#FF2525",
      shadowOpacity: 0.2,
      shadowRadius: 12,
      elevation: 5,
    },

    submitText: {
      color: "#FFFFFF",
      fontSize: 13,
      fontWeight: "900",
      letterSpacing: 1,
    },

    pressed: {
      opacity: 0.75,
      transform: [{ scale: 0.99 }],
    },

    disabled: {
      opacity: 0.55,
    },

    /* ---------- DIVIDER ---------- */

    dividerRow: {
      flexDirection: "row",
      alignItems: "center",
      marginVertical: 22,
    },

    divider: {
      flex: 1,
      height: 1,
      backgroundColor: "#29313A",
    },

    orText: {
      color: "#6F7985",
      fontSize: 10,
      fontWeight: "800",
      marginHorizontal: 13,
    },

    /* ---------- SECONDARY ---------- */

    secondaryButton: {
      minHeight: 53,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: "#59636F",
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 9,
    },

    secondaryText: {
      color: "#FFFFFF",
      fontSize: 12,
      fontWeight: "900",
      letterSpacing: 0.7,
    },

    /* ---------- INFO ---------- */

    infoBox: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      marginTop: 17,
      padding: 11,
      borderRadius: 10,
      backgroundColor: "#111820",
      borderWidth: 1,
      borderColor: "#252E38",
    },

    hint: {
      color: "#7D8895",
      fontSize: 10.5,
      lineHeight: 16,
      flex: 1,
    },

    /* ---------- SECURITY ---------- */

    security: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 7,
      borderTopWidth: 1,
      borderTopColor: "#252C34",
      marginTop: 22,
      paddingTop: 18,
    },

    securityText: {
      color: "#687380",
      fontSize: 10,
    },

    /* ---------- FOOTER ---------- */

    safetyNote: {
      width: "100%",
      maxWidth: 1400,
      alignSelf: "center",
      color: "#56616E",
      fontSize: 9,
      fontWeight: "700",
      letterSpacing: 1.4,
      marginTop: 45,
      textAlign: "center",
    },
  })
);


/* ========================================================= */
/* FEATURE STYLES                                             */
/* ========================================================= */

const stylesFeature = StyleSheet.create({
  feature: {
    flexDirection: "row",
    alignItems: "center",
  },

  icon: {
    width: 48,
    height: 48,
    borderRadius: 13,
    backgroundColor: "rgba(248, 235, 233, 0.08)",
    borderWidth: 1,
    borderColor: "#d2a5a8",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },

  title: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
  },

  subtitle: {
    color: "#778390",
    fontSize: 11,
    marginTop: 2,
  },
});