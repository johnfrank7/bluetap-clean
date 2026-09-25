import React, { useEffect, useState } from 'react';

export function getGreeting(date = new Date()) {
  const hours = date.getHours();
  if (hours < 12) return 'Good Morning';
  if (hours < 18) return 'Good Afternoon';
  return 'Good Evening';
}

export function useLiveGreeting(intervalMs = 30_000) {
  const [greeting, setGreeting] = useState(() => getGreeting());

  useEffect(() => {
    const update = () => {
      const next = getGreeting();
      setGreeting((prev) => (prev !== next ? next : prev));
    };
    const timer = setInterval(update, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return greeting;
}

export function useLiveDate(intervalMs = 60_000) {
  const [date, setDate] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setDate(new Date());
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return date;
}
