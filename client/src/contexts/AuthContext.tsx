import React, { createContext, useContext, useState, useEffect } from "react";
import api from "@/services/api";

interface User {
  id: number;
  fullName: string;
  email: string;
  role: string;
  avatar?: string;
  card_number?: string;
  cardNumber?: string;
  name?: string;
  full_name?: string;
}

export interface AccountStatusNotice {
  id?: number;
  kind: "approved" | "unlocked";
  title: string;
  message: string;
  cardNumber?: string | null;
  createdAt?: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  accountNotice: AccountStatusNotice | null;
  login: (token: string, user: User, accountNotice?: AccountStatusNotice | null) => void;
  dismissAccountNotice: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [accountNotice, setAccountNotice] = useState<AccountStatusNotice | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const storedToken = localStorage.getItem("token");
    const storedUser = localStorage.getItem("user");
    const storedNotice = localStorage.getItem("accountNotice");

    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
      if (storedNotice) {
        try {
          setAccountNotice(JSON.parse(storedNotice));
        } catch {
          localStorage.removeItem("accountNotice");
        }
      }
    }
    setLoading(false);
  }, []);

  const login = (newToken: string, newUser: User, notice: AccountStatusNotice | null = null) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem("token", newToken);
    localStorage.setItem("user", JSON.stringify(newUser));
    if (notice) {
      setAccountNotice(notice);
      localStorage.setItem("accountNotice", JSON.stringify(notice));
    } else {
      setAccountNotice(null);
      localStorage.removeItem("accountNotice");
    }
  };

  const dismissAccountNotice = () => {
    const noticeId = accountNotice?.id;
    setAccountNotice(null);
    localStorage.removeItem("accountNotice");
    if (noticeId) {
      api.put(`/notifications/${noticeId}/read`).catch(() => {});
    }
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    setAccountNotice(null);
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("accountNotice");
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, accountNotice, login, dismissAccountNotice, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
